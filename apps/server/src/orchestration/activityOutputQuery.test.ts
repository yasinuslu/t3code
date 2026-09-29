import { EventId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionThreadActivityRepositoryLive } from "../persistence/Layers/ProjectionThreadActivities.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import {
  ACTIVITY_OUTPUT_CHAR_CAP,
  capActivityOutput,
  extractActivityOutputText,
  readActivityOutput,
} from "./activityOutputQuery.ts";

it("extracts full output from each provider's tool payload shape", () => {
  // Claude: the raw tool_result block, string or text-block content.
  assert.equal(
    extractActivityOutputText({
      data: {
        toolName: "Bash",
        input: { command: "ls" },
        result: { type: "tool_result", content: "a.txt\nb.txt\n" },
      },
    }),
    "a.txt\nb.txt\n",
  );
  assert.equal(
    extractActivityOutputText({
      data: {
        result: {
          content: [
            { type: "text", text: "one" },
            { type: "text", text: "two" },
          ],
        },
      },
    }),
    "one\ntwo",
  );
  // Codex command items.
  assert.equal(
    extractActivityOutputText({ data: { item: { command: "ls", aggregatedOutput: "x\ny" } } }),
    "x\ny",
  );
  // Raw stdout/stderr streams.
  assert.equal(
    extractActivityOutputText({ data: { rawOutput: { stdout: "out", stderr: "err" } } }),
    "out\nerr",
  );
  // ACP content.
  assert.equal(
    extractActivityOutputText({
      data: { content: [{ type: "content", content: { type: "text", text: "acp" } }] },
    }),
    "acp",
  );
  assert.equal(extractActivityOutputText({ data: { input: { command: "true" } } }), null);
  assert.equal(extractActivityOutputText({ detail: "no data" }), null);
});

it("caps long output, keeping the head and the tail", () => {
  const output = `HEAD${"m".repeat(ACTIVITY_OUTPUT_CHAR_CAP * 2)}TAIL`;
  const capped = capActivityOutput(output);
  assert.equal(capped.truncated, true);
  assert.ok(capped.output.startsWith("HEAD"));
  assert.ok(capped.output.endsWith("TAIL"));
  assert.ok(capped.output.includes("characters omitted"));
  assert.ok(capped.output.length < ACTIVITY_OUTPUT_CHAR_CAP + 100);
  assert.deepEqual(capActivityOutput("short"), { output: "short", truncated: false });
});

const layer = it.layer(
  ProjectionThreadActivityRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("readActivityOutput", (it) => {
  it.effect("reads the persisted output of one activity, scoped to its thread", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const threadId = ThreadId.make("thread-activity-output");
      const activityId = EventId.make("activity-bash-completed");
      yield* repository.upsert({
        activityId,
        threadId,
        turnId: null,
        tone: "tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          status: "failed",
          data: {
            toolName: "Bash",
            input: { command: "exit 3" },
            result: { type: "tool_result", content: "Exit code 3\nboom", is_error: true },
          },
        },
        sequence: 1,
        createdAt: "2026-09-29T00:00:00.000Z",
      });

      const result = yield* readActivityOutput({ threadId, activityId });
      assert.deepEqual(result, {
        activityId,
        output: "Exit code 3\nboom",
        truncated: false,
      });

      const otherThread = yield* Effect.flip(
        readActivityOutput({ threadId: ThreadId.make("another-thread"), activityId }),
      );
      assert.equal(otherThread._tag, "OrchestrationGetActivityOutputError");
    }),
  );
});
