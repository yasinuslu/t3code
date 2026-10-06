/**
 * The work overview: every thread a user is running, sorted into what needs
 * them, what is working, what waits for review and what finished recently.
 * Built only from thread shells, so it is the same on every client and
 * survives restarts.
 */
import * as DateTime from "effect/DateTime";

import type { EnvironmentThreadShell } from "./models.ts";
import { effectiveSnoozed } from "./threadSettled.ts";

export type WorkGroup = "needsMe" | "working" | "review" | "done";

/** Why a thread is in its group, for the row's label. */
export type WorkReason =
  | "approval"
  | "input"
  | "failed"
  | "limited"
  | "working"
  | "waiting"
  | "ready"
  | "settled";

export type WorkThreadInput = Pick<
  EnvironmentThreadShell,
  | "archivedAt"
  | "deletedAt"
  | "lineage"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "runtime"
  | "latestRun"
  | "settledOverride"
  | "snoozedUntil"
  | "snoozedAt"
  | "latestUserMessageAt"
  | "createdAt"
>;

export interface WorkItem<T extends WorkThreadInput> {
  readonly thread: T;
  readonly reason: WorkReason;
  /** Newest of the thread's sends, run starts and completions. */
  readonly lastActivityAt: string;
}

export type WorkOverview<T extends WorkThreadInput> = Readonly<
  Record<WorkGroup, ReadonlyArray<WorkItem<T>>>
>;

/** Settled threads count as recently done for this long after their last activity. */
export const RECENTLY_DONE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RECENTLY_DONE_LIMIT = 10;

const ACTIVE_RUNTIME_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

function epochMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function threadLastActivityAt(thread: WorkThreadInput): string {
  let latest = thread.createdAt;
  for (const candidate of [
    thread.latestUserMessageAt,
    thread.latestRun?.requestedAt,
    thread.latestRun?.startedAt,
    thread.latestRun?.completedAt,
    thread.runtime?.activityStartedAt,
  ]) {
    if (candidate && epochMs(candidate) > epochMs(latest)) latest = candidate;
  }
  return latest;
}

/**
 * Where a thread stands, or null when it is not part of the overview:
 * archived, deleted, a subagent of another thread, snoozed, or settled longer
 * ago than the recently-done window. What needs the user wins over activity.
 */
export function classifyWorkThread(
  thread: WorkThreadInput,
  now: number,
): { readonly group: WorkGroup; readonly reason: WorkReason } | null {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  if (thread.lineage.relationshipToParent === "subagent") return null;
  if (thread.hasPendingApprovals) return { group: "needsMe", reason: "approval" };
  if (thread.hasPendingUserInput) return { group: "needsMe", reason: "input" };
  const status = thread.runtime?.status;
  if (status !== undefined && ACTIVE_RUNTIME_STATUSES.has(status)) {
    return { group: "working", reason: "working" };
  }
  // Stopped, with background work (subagents, monitors) that will wake it.
  if (status === "idle") return { group: "working", reason: "waiting" };
  if (thread.settledOverride === "settled") {
    return now - epochMs(threadLastActivityAt(thread)) <= RECENTLY_DONE_WINDOW_MS
      ? { group: "done", reason: "settled" }
      : null;
  }
  if (effectiveSnoozed(thread, { now: DateTime.formatIso(DateTime.makeUnsafe(now)) })) return null;
  if (status === "failed") {
    return {
      group: "needsMe",
      reason: thread.runtime?.lastErrorClass === "usage_limit" ? "limited" : "failed",
    };
  }
  return { group: "review", reason: "ready" };
}

/** Every group newest activity first; recently done is capped. */
export function buildWorkOverview<T extends WorkThreadInput>(
  threads: ReadonlyArray<T>,
  now: number,
): WorkOverview<T> {
  const groups: Record<WorkGroup, WorkItem<T>[]> = {
    needsMe: [],
    working: [],
    review: [],
    done: [],
  };
  for (const thread of threads) {
    const placement = classifyWorkThread(thread, now);
    if (placement === null) continue;
    groups[placement.group].push({
      thread,
      reason: placement.reason,
      lastActivityAt: threadLastActivityAt(thread),
    });
  }
  const newestFirst = (left: WorkItem<T>, right: WorkItem<T>) =>
    epochMs(right.lastActivityAt) - epochMs(left.lastActivityAt);
  return {
    needsMe: groups.needsMe.sort(newestFirst),
    working: groups.working.sort(newestFirst),
    review: groups.review.sort(newestFirst),
    done: groups.done.sort(newestFirst).slice(0, RECENTLY_DONE_LIMIT),
  };
}
