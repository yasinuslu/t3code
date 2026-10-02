/**
 * A brainstorm task linked to threads checks itself off once the work is done:
 * when a linked thread's run ends well and every other thread the task links
 * has ended well too.
 */
import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadShell,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import { parseTaskMarkdown, updateTask } from "./taskMarkdown.ts";

export type SettledCheckShell = Pick<
  OrchestrationV2ThreadShell,
  "status" | "activeRunId" | "pendingRuntimeRequest" | "deletedAt"
>;

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** Whether a thread is idle after a completed run, with nothing waiting on the user. */
export function isSettledAfterSuccess(thread: SettledCheckShell | null | undefined): boolean {
  if (!thread || thread.deletedAt !== null) return false;
  if (thread.pendingRuntimeRequest !== null || thread.activeRunId !== null) return false;
  // The shell's status is its latest run's, so a queued follow-up keeps it open.
  return thread.status === "completed";
}

/**
 * Follows run changes and returns the thread whose run just ended: one seen
 * active that has now left the active states. Only that edge counts, so a
 * task the user reopens stays open until its thread works again, and later
 * updates of a finished run (checkpoints, background work) are not new ends.
 */
export function makeTurnEndTracker() {
  const active = new Set<RunId>();
  return (event: OrchestrationV2DomainEvent): ThreadId | null => {
    if (event.type !== "run.created" && event.type !== "run.updated") return null;
    const run = event.payload;
    if (ACTIVE_RUN_STATUSES.has(run.status)) {
      active.add(run.id);
      return null;
    }
    return active.delete(run.id) ? run.threadId : null;
  };
}

/**
 * Marks done the open tasks that link `threadId` and whose linked threads have
 * all settled, per `isSettled`. Returns the new text and the completed titles.
 */
export function completeSettledTasks(
  text: string,
  threadId: string,
  isSettled: (threadId: string) => boolean,
): { text: string; completed: string[] } {
  let next = text;
  const completed: string[] = [];
  for (const task of parseTaskMarkdown(text).tasks) {
    if (task.done || !task.threadIds.includes(threadId)) continue;
    if (!task.threadIds.every(isSettled)) continue;
    // Checking a task off keeps every task's number, so later ones still match.
    next = updateTask(next, task.number, { done: true }).text;
    completed.push(task.title);
  }
  return { text: next, completed };
}
