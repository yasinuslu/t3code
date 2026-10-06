import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadRuntimeSummary } from "./models.ts";
import {
  RECENTLY_DONE_LIMIT,
  buildWorkOverview,
  classifyWorkThread,
  threadLastActivityAt,
  type WorkThreadInput,
} from "./workOverview.ts";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

interface TestThread extends WorkThreadInput {
  readonly id: string;
}

function makeThread(
  id: string,
  overrides: Partial<Omit<TestThread, "runtime">> & {
    readonly runtimeStatus?: ThreadRuntimeSummary["status"];
    readonly lastErrorClass?: ThreadRuntimeSummary["lastErrorClass"];
  } = {},
): TestThread {
  const { runtimeStatus, lastErrorClass, ...rest } = overrides;
  return {
    id,
    archivedAt: null,
    deletedAt: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: ThreadId.make(id),
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime:
      runtimeStatus === undefined
        ? null
        : {
            status: runtimeStatus,
            activeRunId: null,
            providerInstanceId: "claudeAgent" as ThreadRuntimeSummary["providerInstanceId"],
            providerName: null,
            lastError: null,
            lastErrorClass: lastErrorClass ?? null,
            updatedAt: "2026-10-06T11:00:00.000Z",
          },
    latestRun: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: "2026-10-06T11:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...rest,
  };
}

describe("classifyWorkThread", () => {
  it("puts approvals, questions and failures under needs me, ahead of activity", () => {
    expect(
      classifyWorkThread(
        makeThread("a", { hasPendingApprovals: true, runtimeStatus: "running" }),
        NOW,
      ),
    ).toEqual({ group: "needsMe", reason: "approval" });
    expect(classifyWorkThread(makeThread("b", { hasPendingUserInput: true }), NOW)).toEqual({
      group: "needsMe",
      reason: "input",
    });
    expect(classifyWorkThread(makeThread("c", { runtimeStatus: "failed" }), NOW)).toEqual({
      group: "needsMe",
      reason: "failed",
    });
    expect(
      classifyWorkThread(
        makeThread("d", { runtimeStatus: "failed", lastErrorClass: "usage_limit" }),
        NOW,
      ),
    ).toEqual({ group: "needsMe", reason: "limited" });
  });

  it("counts running and background-waiting threads as working", () => {
    expect(classifyWorkThread(makeThread("a", { runtimeStatus: "running" }), NOW)?.reason).toBe(
      "working",
    );
    expect(classifyWorkThread(makeThread("b", { runtimeStatus: "idle" }), NOW)).toEqual({
      group: "working",
      reason: "waiting",
    });
  });

  it("puts finished unsettled threads up for review and recently settled ones under done", () => {
    expect(classifyWorkThread(makeThread("a", { runtimeStatus: "completed" }), NOW)?.group).toBe(
      "review",
    );
    expect(classifyWorkThread(makeThread("b", { settledOverride: "settled" }), NOW)?.group).toBe(
      "done",
    );
    expect(
      classifyWorkThread(
        makeThread("c", {
          settledOverride: "settled",
          latestUserMessageAt: "2026-10-01T00:00:00.000Z",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it("leaves out archived, deleted, subagent and snoozed threads", () => {
    expect(
      classifyWorkThread(makeThread("a", { archivedAt: "2026-10-06T00:00:00.000Z" }), NOW),
    ).toBeNull();
    expect(
      classifyWorkThread(makeThread("b", { deletedAt: "2026-10-06T00:00:00.000Z" }), NOW),
    ).toBeNull();
    expect(
      classifyWorkThread(
        makeThread("c", {
          lineage: {
            parentThreadId: ThreadId.make("a"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("a"),
          },
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      classifyWorkThread(
        makeThread("d", {
          snoozedAt: "2026-10-06T10:00:00.000Z",
          snoozedUntil: "2026-10-07T09:00:00.000Z",
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("buildWorkOverview", () => {
  it("groups threads newest activity first and caps recently done", () => {
    const settled = Array.from({ length: RECENTLY_DONE_LIMIT + 2 }, (_, index) =>
      makeThread(`settled-${index}`, {
        settledOverride: "settled",
        latestUserMessageAt: `2026-10-06T0${index % 10}:00:00.000Z`,
      }),
    );
    const overview = buildWorkOverview(
      [
        makeThread("old-review", { latestUserMessageAt: "2026-10-05T00:00:00.000Z" }),
        makeThread("new-review", { latestUserMessageAt: "2026-10-06T10:00:00.000Z" }),
        makeThread("working", { runtimeStatus: "running" }),
        makeThread("question", { hasPendingUserInput: true }),
        ...settled,
      ],
      NOW,
    );
    expect(overview.needsMe.map((item) => item.thread.id)).toEqual(["question"]);
    expect(overview.working.map((item) => item.thread.id)).toEqual(["working"]);
    expect(overview.review.map((item) => item.thread.id)).toEqual(["new-review", "old-review"]);
    expect(overview.done).toHaveLength(RECENTLY_DONE_LIMIT);
    expect(overview.done[0]?.thread.latestUserMessageAt).toBe("2026-10-06T09:00:00.000Z");
  });
});

describe("threadLastActivityAt", () => {
  it("takes the newest of sends, run starts and completions", () => {
    expect(
      threadLastActivityAt(
        makeThread("a", {
          latestUserMessageAt: "2026-10-06T08:00:00.000Z",
          latestRun: {
            runId: RunId.make("run-1"),
            status: "completed",
            requestedAt: "2026-10-06T08:00:00.000Z",
            startedAt: "2026-10-06T08:00:01.000Z",
            completedAt: "2026-10-06T09:30:00.000Z",
            assistantMessageId: null,
          },
        }),
      ),
    ).toBe("2026-10-06T09:30:00.000Z");
  });
});
