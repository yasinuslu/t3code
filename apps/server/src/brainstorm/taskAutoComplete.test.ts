import {
  EventId,
  type OrchestrationEvent,
  type OrchestrationSessionStatus,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  completeSettledTasks,
  isSettledAfterSuccess,
  makeTurnEndTracker,
} from "./taskAutoComplete.ts";
import { parseTaskMarkdown } from "./taskMarkdown.ts";

const A = ThreadId.make("thread-a");
const B = ThreadId.make("thread-b");

const session = (threadId: ThreadId, status: OrchestrationSessionStatus) => ({
  threadId,
  status,
  providerName: "claudeAgent",
  runtimeMode: "full-access" as const,
  activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
  lastError: null,
  updatedAt: "2026-09-29T00:00:00.000Z",
});

const shell = (overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell => ({
  id: A,
  projectId: ProjectId.make("p"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: "2026-09-29T00:00:00.000Z",
    startedAt: "2026-09-29T00:00:00.000Z",
    completedAt: "2026-09-29T00:01:00.000Z",
    assistantMessageId: null,
  },
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:01:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: session(A, "ready"),
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const sessionSet = (threadId: ThreadId, status: OrchestrationSessionStatus) =>
  ({
    sequence: 1,
    eventId: EventId.make(`event-${threadId}-${status}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: "2026-09-29T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set",
    payload: { threadId, session: session(threadId, status) },
  }) as OrchestrationEvent;

describe("isSettledAfterSuccess", () => {
  it("accepts an idle thread whose last turn completed", () => {
    expect(isSettledAfterSuccess(shell())).toBe(true);
    expect(isSettledAfterSuccess(shell({ session: session(A, "stopped") }))).toBe(true);
  });

  it("rejects a failed, interrupted, running or missing turn", () => {
    const turn = shell().latestTurn!;
    expect(isSettledAfterSuccess(shell({ latestTurn: { ...turn, state: "error" } }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ latestTurn: { ...turn, state: "interrupted" } }))).toBe(
      false,
    );
    expect(isSettledAfterSuccess(shell({ session: session(A, "running") }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ session: session(A, "error") }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ latestTurn: null }))).toBe(false);
    expect(isSettledAfterSuccess(undefined)).toBe(false);
  });

  it("rejects a thread waiting on the user", () => {
    expect(isSettledAfterSuccess(shell({ hasPendingApprovals: true }))).toBe(false);
    expect(isSettledAfterSuccess(shell({ hasPendingUserInput: true }))).toBe(false);
  });
});

describe("makeTurnEndTracker", () => {
  it("reports a thread only when it stops running", () => {
    const turnEnded = makeTurnEndTracker();
    expect(turnEnded(sessionSet(A, "starting"))).toBeNull();
    expect(turnEnded(sessionSet(A, "ready"))).toBeNull();
    expect(turnEnded(sessionSet(A, "running"))).toBeNull();
    expect(turnEnded(sessionSet(A, "running"))).toBeNull();
    expect(turnEnded(sessionSet(A, "ready"))).toBe(A);
  });

  it("does not report again without new activity", () => {
    const turnEnded = makeTurnEndTracker();
    turnEnded(sessionSet(A, "running"));
    expect(turnEnded(sessionSet(A, "ready"))).toBe(A);
    // A later stop or restart of the idle session is not a new settle.
    expect(turnEnded(sessionSet(A, "stopped"))).toBeNull();
    turnEnded(sessionSet(A, "running"));
    expect(turnEnded(sessionSet(A, "ready"))).toBe(A);
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
