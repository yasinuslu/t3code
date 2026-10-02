import {
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  completeSettledTasks,
  isSettledAfterSuccess,
  makeTurnEndTracker,
  type SettledCheckShell,
} from "./taskAutoComplete.ts";
import { parseTaskMarkdown } from "./taskMarkdown.ts";

const A = ThreadId.make("thread-a");
const B = ThreadId.make("thread-b");
const NOW = DateTime.makeUnsafe("2026-09-29T00:00:00.000Z");

const shell = (overrides: Partial<SettledCheckShell> = {}): SettledCheckShell => ({
  status: "completed",
  activeRunId: null,
  pendingRuntimeRequest: null,
  deletedAt: null,
  ...overrides,
});

const run = (
  threadId: ThreadId,
  ordinal: number,
  status: OrchestrationV2RunStatus,
): OrchestrationV2Run => ({
  id: RunId.make(`run-${threadId}-${ordinal}`),
  threadId,
  ordinal,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message-${threadId}-${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: NOW,
  startedAt: null,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
});

let eventCount = 0;
const runEvent = (
  threadId: ThreadId,
  ordinal: number,
  status: OrchestrationV2RunStatus,
  type: "run.created" | "run.updated" = "run.updated",
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event-${(eventCount += 1)}`),
  type,
  threadId,
  runId: RunId.make(`run-${threadId}-${ordinal}`),
  occurredAt: NOW,
  payload: run(threadId, ordinal, status),
});

describe("isSettledAfterSuccess", () => {
  it("accepts an idle thread whose last run completed", () => {
    expect(isSettledAfterSuccess(shell())).toBe(true);
  });

  it("rejects a failed, interrupted, running or missing run", () => {
    expect(isSettledAfterSuccess(shell({ status: "failed" }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ status: "interrupted" }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ status: "cancelled" }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ status: "running", activeRunId: RunId.make("r") }))).toBe(
      false,
    );
    // A follow-up queued behind a finished run is not done yet.
    expect(isSettledAfterSuccess(shell({ status: "queued" }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ status: "idle" }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ deletedAt: NOW }))).toBe(false);
    expect(isSettledAfterSuccess(undefined)).toBe(false);
    expect(isSettledAfterSuccess(null)).toBe(false);
  });

  it("rejects a thread waiting on the user", () => {
    expect(
      isSettledAfterSuccess(
        shell({
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("request"),
            kind: "permission",
            createdAt: NOW,
          },
        }),
      ),
    ).toBe(false);
    expect(isSettledAfterSuccess(shell({ status: "waiting" }))).toBe(false);
  });
});

describe("makeTurnEndTracker", () => {
  it("reports a thread only when its run stops being active", () => {
    const turnEnded = makeTurnEndTracker();
    expect(turnEnded(runEvent(A, 1, "queued", "run.created"))).toBeNull();
    expect(turnEnded(runEvent(A, 1, "starting"))).toBeNull();
    expect(turnEnded(runEvent(A, 1, "running"))).toBeNull();
    expect(turnEnded(runEvent(A, 1, "running"))).toBeNull();
    expect(turnEnded(runEvent(A, 1, "completed"))).toBe(A);
  });

  it("does not report again without new activity", () => {
    const turnEnded = makeTurnEndTracker();
    turnEnded(runEvent(A, 1, "running"));
    expect(turnEnded(runEvent(A, 1, "completed"))).toBe(A);
    // A later update of the finished run (a checkpoint, say) is not a new end.
    expect(turnEnded(runEvent(A, 1, "completed"))).toBeNull();
    // A run never seen active (it ended before the tracker started) is not reported.
    expect(turnEnded(runEvent(B, 1, "completed"))).toBeNull();
    turnEnded(runEvent(A, 2, "running", "run.created"));
    expect(turnEnded(runEvent(A, 2, "failed"))).toBe(A);
  });

  it("ignores events that are not about runs", () => {
    const turnEnded = makeTurnEndTracker();
    turnEnded(runEvent(A, 1, "running"));
    const other = { ...runEvent(A, 1, "completed"), type: "run.background-work-cancelled" };
    expect(turnEnded(other as OrchestrationV2DomainEvent)).toBeNull();
    expect(turnEnded(runEvent(A, 1, "completed"))).toBe(A);
  });
});

describe("completeSettledTasks", () => {
  const TEXT = [
    "# Tasks",
    "",
    "- [ ] Only A",
    "  - thread: thread-a",
    "- [ ] A and B",
    "  - thread: thread-a",
    "  - thread: thread-b",
    "- [ ] Not linked",
    "- [x] Already done",
    "  - thread: thread-a",
    "",
  ].join("\n");
  const done = (text: string) =>
    parseTaskMarkdown(text)
      .tasks.filter((task) => task.done)
      .map((task) => task.title);

  it("checks off a task once every linked thread settled", () => {
    const onlyA = completeSettledTasks(TEXT, A, (id) => id === A);
    expect(onlyA.completed).toEqual(["Only A"]);
    expect(done(onlyA.text)).toEqual(["Only A", "Already done"]);

    const both = completeSettledTasks(onlyA.text, B, () => true);
    expect(both.completed).toEqual(["A and B"]);
    expect(done(both.text)).toEqual(["Only A", "A and B", "Already done"]);
  });

  it("leaves tasks of other threads and unsettled tasks as they are", () => {
    expect(completeSettledTasks(TEXT, B, (id) => id === B)).toEqual({ text: TEXT, completed: [] });
    expect(completeSettledTasks(TEXT, A, () => false)).toEqual({ text: TEXT, completed: [] });
  });
});
