/**
 * On-demand full output for one tool activity.
 *
 * Thread snapshots and live activity events carry only a one-line output
 * summary (see ActivityPayloadProjection), which keeps thread transfer small.
 * When a user expands a tool row, the client asks for that activity's output
 * here; the persisted `tool.completed` payload still holds all of it.
 */
import {
  OrchestrationGetActivityOutputError,
  type OrchestrationGetActivityOutputInput,
  type OrchestrationGetActivityOutputResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";

/** Characters returned per activity; the rest is elided from the middle. */
export const ACTIVITY_OUTPUT_CHAR_CAP = 64_000;
const ACTIVITY_OUTPUT_HEAD_CHARS = 16_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Text of a Claude `tool_result` block or an MCP `{content: [...]}` result. */
function resultText(value: unknown): string | null {
  const direct = nonEmpty(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  const content = nonEmpty(record.content);
  if (content) return content;
  if (Array.isArray(record.content)) {
    const texts = record.content.flatMap((entry) => {
      const text = nonEmpty(asRecord(entry)?.text);
      return text ? [text] : [];
    });
    if (texts.length > 0) return texts.join("\n");
  }
  return null;
}

function rawOutputText(value: unknown): string | null {
  const direct = nonEmpty(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record) return null;
  const streams = [nonEmpty(record.stdout), nonEmpty(record.stderr)].filter(
    (stream): stream is string => stream !== null,
  );
  if (streams.length > 0) return streams.join("\n");
  return nonEmpty(record.content) ?? nonEmpty(record.output);
}

function acpContentText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const texts = value.flatMap((entry) => {
    const record = asRecord(entry);
    const text = record?.type === "content" ? nonEmpty(asRecord(record.content)?.text) : null;
    return text ? [text] : [];
  });
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * Full output text of a tool activity payload across providers: Codex
 * command items (`aggregatedOutput`), Claude tool results, ACP content,
 * raw stdout/stderr, and MCP results. Null when the payload has none.
 */
export function extractActivityOutputText(payloadValue: unknown): string | null {
  const data = asRecord(asRecord(payloadValue)?.data);
  if (!data) return null;
  const item = asRecord(data.item);
  return (
    nonEmpty(item?.aggregatedOutput) ??
    resultText(item?.result) ??
    rawOutputText(data.rawOutput) ??
    acpContentText(data.content) ??
    resultText(data.result) ??
    rawOutputText(asRecord(data.state)?.output) ??
    null
  );
}

/** Caps output at ACTIVITY_OUTPUT_CHAR_CAP, keeping its head and tail. */
export function capActivityOutput(output: string): { output: string; truncated: boolean } {
  if (output.length <= ACTIVITY_OUTPUT_CHAR_CAP) {
    return { output, truncated: false };
  }
  const tailChars = ACTIVITY_OUTPUT_CHAR_CAP - ACTIVITY_OUTPUT_HEAD_CHARS;
  const omitted = output.length - ACTIVITY_OUTPUT_CHAR_CAP;
  return {
    output: `${output.slice(0, ACTIVITY_OUTPUT_HEAD_CHARS)}\n… ${omitted.toLocaleString("en-US")} characters omitted …\n${output.slice(-tailChars)}`,
    truncated: true,
  };
}

export const readActivityOutput = Effect.fn("orchestration.readActivityOutput")(function* (
  input: OrchestrationGetActivityOutputInput,
) {
  const repository = yield* ProjectionThreadActivityRepository;
  const row = yield* repository.getById(input).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationGetActivityOutputError({
          message: "Failed to load activity output",
          cause,
        }),
    ),
  );
  if (Option.isNone(row)) {
    return yield* new OrchestrationGetActivityOutputError({ message: "Activity not found" });
  }
  const text = extractActivityOutputText(row.value.payload);
  const capped = text === null ? null : capActivityOutput(text);
  return {
    activityId: input.activityId,
    output: capped?.output ?? null,
    truncated: capped?.truncated ?? false,
  } satisfies OrchestrationGetActivityOutputResult;
});
