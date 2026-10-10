import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
  type ThreadAutoCompact,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** Quiet time after the last run before a thread counts as idle. */
const IDLE_MS = 5 * 60_000;
/** Floor between two automatic compactions, whatever the context reads. */
const MIN_GAP_MS = 30 * 60_000;
/** The shared scheduler ticks every few seconds; these checks need far less. */
const SWEEP_INTERVAL_MS = 60_000;

const BUSY_STATUSES: ReadonlySet<OrchestrationV2ThreadShell["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/**
 * The provider's own `/compact` for an idle thread whose context reached the
 * threshold, or whose interval since the last compaction passed. Only after
 * new activity since that compaction, so one compaction never repeats itself.
 */
export function autoCompactCommand(input: {
  readonly thread: OrchestrationV2ThreadShell;
  readonly settings: ThreadAutoCompact;
  readonly contextTokens: number | null;
  readonly lastCompactionAtMs: number | null;
  readonly nowMs: number;
}): OrchestrationV2Command | null {
  const { thread, settings, contextTokens, lastCompactionAtMs, nowMs } = input;
  if (
    thread.archivedAt !== null ||
    thread.activeRunId !== null ||
    BUSY_STATUSES.has(thread.status) ||
    thread.pendingRuntimeRequest !== null ||
    thread.latestRunId === null ||
    thread.latestRunCompletedAt == null ||
    nowMs - DateTime.toEpochMillis(thread.latestRunCompletedAt) < IDLE_MS
  )
    return null;
  const lastActivityMs =
    thread.latestVisibleMessage === null
      ? null
      : DateTime.toEpochMillis(thread.latestVisibleMessage.updatedAt);
  if (lastActivityMs === null) return null;
  if (lastCompactionAtMs !== null) {
    if (lastActivityMs <= lastCompactionAtMs || nowMs - lastCompactionAtMs < MIN_GAP_MS) {
      return null;
    }
  }
  const overThreshold = contextTokens !== null && contextTokens >= settings.thresholdTokens;
  const intervalDue =
    settings.intervalHours !== undefined &&
    nowMs - (lastCompactionAtMs ?? DateTime.toEpochMillis(thread.createdAt)) >=
      settings.intervalHours * 3_600_000;
  if (!overThreshold && !intervalDue) return null;
  // Keyed by the run it follows: a retried sweep re-sends the same command.
  const identity = `auto-compact:${thread.id}:${thread.latestRunId}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: thread.id,
    text: "/compact",
    attachments: [],
    // A run that slipped in since the check queues this behind it, never interrupts it.
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  let lastSweepMs = 0;
  return Effect.fn("ThreadAutoCompactWorker.sweep")(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (nowMs - lastSweepMs < SWEEP_INTERVAL_MS) return;
    lastSweepMs = nowMs;
    const candidates = yield* projections.getAutoCompactThreads();
    for (const candidate of candidates) {
      if (candidate.autoCompact == null) continue;
      const settings = candidate.autoCompact;
      yield* Effect.gen(function* () {
        const shell = yield* projections.getThreadShell(candidate.id);
        if (shell === null) return;
        const records = yield* projections.getThreadRecords(
          candidate.id,
          ["providerThreads", "turnItems"],
          { turnItemTypes: ["compaction"], turnItemStatuses: ["completed"] },
        );
        const providerThread = records.providerThreads.find(
          (providerThread) => providerThread.id === shell.activeProviderThreadId,
        );
        const lastCompactionAtMs = records.turnItems.reduce<number | null>(
          (latest, item) =>
            Math.max(latest ?? 0, DateTime.toEpochMillis(item.completedAt ?? item.updatedAt)),
          null,
        );
        const command = autoCompactCommand({
          thread: shell,
          settings,
          contextTokens: providerThread?.contextUsage?.usedTokens ?? null,
          lastCompactionAtMs,
          nowMs,
        });
        if (command === null) return;
        yield* threads.dispatch(command);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.auto-compact.failed", {
            threadId: candidate.id,
            cause,
          }),
        ),
      );
    }
  });
});

// Due work derives from persisted thread state, so restarts need no timer restoration.
export const workerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("thread-auto-compact", sweep());
  }),
);
