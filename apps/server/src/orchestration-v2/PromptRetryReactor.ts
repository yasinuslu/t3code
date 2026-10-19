import {
  CommandId,
  isProviderNativeSubagentThread,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  latestExecutedRun,
  latestRootProviderFailure,
  PROMPT_NOT_RUN_FAILURE_CODE,
} from "@t3tools/shared/orchestrationV2ThreadError";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const RESEND_MESSAGE_PREFIX = "prompt-retry:";
const MAX_REMEMBERED_RUNS = 256;

/** Waits before each resend; its length is how many times a message is resent. */
export const RESEND_BACKOFF_MS: ReadonlyArray<number> = [1_000, 4_000, 15_000];

/**
 * The id of a resend. Each carries its position in the chain of resends, which
 * is how the chain is counted, and the time it was sent so a second server holding a
 * copy of this thread's state does not resend under an id this one already used.
 */
export function resendMessageId(attempt: number, sentAt: string): MessageId {
  return MessageId.make(`${RESEND_MESSAGE_PREFIX}${attempt}:${sentAt}`);
}

/** How many resends led to `messageId`: 0 for a message someone sent. */
export function resendAttempt(messageId: MessageId): number {
  if (!messageId.startsWith(RESEND_MESSAGE_PREFIX)) return 0;
  const attempt = Number.parseInt(messageId.slice(RESEND_MESSAGE_PREFIX.length), 10);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
}

interface FailedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

/**
 * Sends a message again when the provider refused to run it. Some failures
 * mean the provider never took the prompt ("send it again"); doing that is
 * safe and needs nobody, so the thread keeps going instead of waiting for the
 * user to notice. Each resend is a new message with a new id, at most
 * `backoff.length` in a row, spaced by the backoff. Only a run that is still
 * the thread's latest is resent: anything sent since has taken over.
 */
export class PromptRetryReactor extends Context.Service<
  PromptRetryReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/PromptRetryReactor") {}

const make = (backoff: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projections = yield* ProjectionStore.ProjectionStoreV2;

    /** The refused message to resend, or null when this run is not one to resend. */
    const readResend = Effect.fn("PromptRetryReactor.readResend")(function* ({
      threadId,
      runId,
    }: FailedRun) {
      const { thread, runs, turnItems } = yield* projections.getThreadRecords(
        threadId,
        ["runs", "turnItems"],
        { turnItemRunIds: [runId], turnItemTypes: ["error"] },
      );
      const run = latestExecutedRun(runs);
      if (
        run?.id !== runId ||
        run.status !== "failed" ||
        latestRootProviderFailure(run, turnItems)?.code !== PROMPT_NOT_RUN_FAILURE_CODE ||
        // Whatever was sent since owns the thread now.
        runs.some((other) => other.status === "queued") ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.settledOverride === "settled" ||
        isProviderNativeSubagentThread(thread)
      )
        return null;
      const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
        messageIds: [run.userMessageId],
      });
      const message = messages.find((candidate) => candidate.id === run.userMessageId);
      return message === undefined ? null : { run, message };
    });

    const resend = Effect.fn("PromptRetryReactor.resend")(function* (failed: FailedRun) {
      const first = yield* readResend(failed);
      if (first === null) return;
      const attempt = resendAttempt(first.run.userMessageId);
      const notice = (signal: string, text: string) =>
        threads.dispatch({
          type: "thread.run-notice.record",
          commandId: CommandId.make(`server:prompt-retry:${signal}:${first.run.id}`),
          threadId: failed.threadId,
          runId: first.run.id,
          signal,
          message: text,
        });
      const delay = backoff[attempt];
      if (delay === undefined) {
        yield* notice(
          "prompt-retry-exhausted",
          `The provider did not run this message after ${backoff.length} resends.`,
        );
        return;
      }
      if (delay > 0) yield* Effect.sleep(delay);
      // The user may have sent something while this waited.
      const current = yield* readResend(failed);
      if (current === null) return;
      yield* threads.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:prompt-retry:resend:${current.run.id}`),
        threadId: failed.threadId,
        messageId: resendMessageId(
          attempt + 1,
          DateTime.toEpochMillis(yield* DateTime.now).toString(36),
        ),
        text: current.message.text,
        ...contextOf(current.message),
        attachments: current.message.attachments,
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      yield* notice(
        "prompt-retry",
        `The provider did not run this message, so it was sent again (${attempt + 1} of ${backoff.length}).`,
      );
    });

    const worker = yield* makeDrainableWorker((run: FailedRun) =>
      resend(run).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("prompt resend skipped", {
              threadId: run.threadId,
              runId: run.runId,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
    );

    // A failed run can be re-announced (recovery, replays); act on it once.
    const seenRuns = new Set<RunId>();
    const enqueueOnce = (run: FailedRun) =>
      Effect.suspend(() => {
        if (seenRuns.has(run.runId)) return Effect.void;
        seenRuns.add(run.runId);
        if (seenRuns.size > MAX_REMEMBERED_RUNS) {
          seenRuns.delete(seenRuns.values().next().value!);
        }
        return worker.enqueue(run);
      });

    const start: PromptRetryReactor["Service"]["start"] = Effect.fn("PromptRetryReactor.start")(
      function* () {
        yield* forkParked(
          Stream.runForEach(engine.streamDomainEvents, (event) =>
            event.type === "run.updated" && event.payload.status === "failed"
              ? enqueueOnce({ threadId: event.threadId, runId: event.payload.id })
              : Effect.void,
          ).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
                Effect.logWarning("prompt resend event stream failed", {
                  cause: Cause.pretty(cause),
                }),
            ),
          ),
        );
      },
    );

    return PromptRetryReactor.of({ start, drain: worker.drain });
  });

const contextOf = (message: OrchestrationV2ConversationMessage) =>
  message.context === undefined ? {} : { context: message.context };

export const layerWithBackoff = (backoff: ReadonlyArray<number>) =>
  Layer.effect(PromptRetryReactor, make(backoff));

export const layer = layerWithBackoff(RESEND_BACKOFF_MS);
