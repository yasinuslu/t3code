import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { type GrowCard, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { IN_USE_LIMIT, buildGrowBoard, growCardKey } from "./grow.logic";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

const shell = (id: string, overrides: Record<string, unknown> = {}): EnvironmentThreadShell =>
  ({
    id,
    environmentId: "env",
    title: id,
    archivedAt: null,
    deletedAt: null,
    lineage: { relationshipToParent: null },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestRun: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: null,
    createdAt: "2026-10-13T10:00:00.000Z",
    pullRequests: [],
    previewLinks: [],
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

const preview = [{ url: "http://localhost:1234" }];

describe("buildGrowBoard", () => {
  it("derives stages from previews, runs and pull requests", () => {
    const board = buildGrowBoard(
      [
        shell("plain"),
        shell("playable", { previewLinks: preview }),
        shell("busy", { previewLinks: preview, runtime: { status: "running" } }),
        shell("merged", { pullRequests: [{ snapshot: { state: "merged" } }] }),
      ],
      new Map(),
      NOW,
    );
    expect(board.exploring.map((c) => c.thread.id)).toEqual(
      expect.arrayContaining(["plain", "busy"]),
    );
    expect(board.play.map((c) => c.thread.id)).toEqual(["playable"]);
    expect(board.play[0]?.playUrl).toBe("http://localhost:1234");
    expect(board.done.map((c) => c.thread.id)).toEqual(["merged"]);
  });

  it("lets stored cards override, shelves win, and keeps old settled threads in use", () => {
    const cards = new Map<string, GrowCard>([
      [
        growCardKey({ environmentId: "env" as never, id: ThreadId.make("held") }),
        { threadId: ThreadId.make("held"), stage: "shelved", lessons: [], updatedAt: "x" },
      ],
    ]);
    const board = buildGrowBoard(
      [
        shell("held", { pullRequests: [{ snapshot: { state: "merged" } }] }),
        shell("old", { settledOverride: "settled", createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
      cards,
      NOW,
    );
    expect(board.shelved.map((c) => c.thread.id)).toEqual(["held"]);
    expect(board.done.map((c) => c.thread.id)).toEqual(["old"]);
  });

  it("caps In use at the most recent threads", () => {
    const threads = Array.from({ length: IN_USE_LIMIT + 3 }, (_, index) =>
      shell(`t${index}`, {
        settledOverride: "settled",
        createdAt: `2026-10-13T0${index % 10}:00:00.000Z`,
      }),
    );
    expect(buildGrowBoard(threads, new Map(), NOW).done).toHaveLength(IN_USE_LIMIT);
  });
});
