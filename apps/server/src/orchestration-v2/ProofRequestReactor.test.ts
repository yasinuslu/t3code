import {
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { proofRequestCommand } from "./ProofRequestReactor.ts";

const THREAD_ID = ThreadId.make("proof-thread");
const AT = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");

function run(id: string, overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run {
  return {
    id: RunId.make(id),
    threadId: THREAD_ID,
    ordinal: 1,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
    checkpointId: null,
    contextHandoffId: null,
    ...overrides,
  } as OrchestrationV2Run;
}

function thread(report: string | null, overrides: Partial<OrchestrationV2AppThread> = {}) {
  return {
    id: THREAD_ID,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    ...(report === null
      ? {}
      : { statusReport: { text: report, updatedAt: "2026-10-19T12:00:00.000Z" } }),
    ...overrides,
  } as OrchestrationV2AppThread;
}

const done = run("run-1");

describe("proofRequestCommand", () => {
  it("asks a thread that reported work without an image", () => {
    const command = proofRequestCommand({
      thread: thread("Shipped the new list."),
      runs: [done],
      runId: done.id,
    });
    expect(command).toMatchObject({ type: "message.dispatch", threadId: THREAD_ID });
  });

  it("leaves a thread alone once its report carries proof", () => {
    for (const image of ["![after](attachment:abc-123)", "![after](/tmp/shot.png)"]) {
      expect(
        proofRequestCommand({ thread: thread(`Done.\n\n${image}`), runs: [done], runId: done.id }),
      ).toBeNull();
    }
  });

  it("leaves a thread alone once it has a presentation", () => {
    const presentation = {
      pages: [{ kind: "doc" as const, markdown: "# The new list" }],
      updatedAt: "2026-10-19T12:00:00.000Z",
    };
    expect(
      proofRequestCommand({
        thread: thread("Done.", { presentation }),
        runs: [done],
        runId: done.id,
      }),
    ).toBeNull();
  });

  it("asks only once: the run answering an ask is not asked again", () => {
    const first = proofRequestCommand({ thread: thread("Done."), runs: [done], runId: done.id });
    if (first?.type !== "message.dispatch") throw new Error("expected a request");
    const answer = run("run-2", { ordinal: 2, userMessageId: first.messageId });
    expect(
      proofRequestCommand({ thread: thread("Done."), runs: [done, answer], runId: answer.id }),
    ).toBeNull();
  });

  it("skips chats with no work to show, subagents and superseded runs", () => {
    expect(proofRequestCommand({ thread: thread(null), runs: [done], runId: done.id })).toBeNull();
    expect(
      proofRequestCommand({
        thread: thread("Done.", {
          lineage: {
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("parent"),
          },
        }),
        runs: [done],
        runId: done.id,
      }),
    ).toBeNull();
    expect(
      proofRequestCommand({
        thread: thread("Done."),
        runs: [done, run("run-2", { ordinal: 2, status: "queued", startedAt: null })],
        runId: done.id,
      }),
    ).toBeNull();
  });
});
