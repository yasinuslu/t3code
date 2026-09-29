/**
 * A brainstorm task linked to threads checks itself off once the work is done:
 * when a linked thread's turn ends well and every other thread the task links
 * has ended well too.
 */
import type { OrchestrationEvent, OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

import { parseTaskMarkdown, updateTask } from "./taskMarkdown.ts";

/** Whether a thread is idle after a completed turn, with nothing waiting on the user. */
export function isSettledAfterSuccess(thread: OrchestrationThreadShell | undefined): boolean {
  if (!thread || thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
  const session = thread.session?.status;
  if (session === "running" || session === "starting" || session === "error") return false;
  return thread.latestTurn?.state === "completed";
}

/**
 * Follows session changes and returns the thread whose turn just ended: one
 * seen running that has now stopped running. Only that edge counts, so a task
 * the user reopens stays open until its thread works again.
 */
export function makeTurnEndTracker() {
  const running = new Set<ThreadId>();
  return (event: OrchestrationEvent): ThreadId | null => {
    if (event.type !== "thread.session-set") return null;
    const { threadId, session } = event.payload;
    if (session.status === "running") {
      running.add(threadId);
      return null;
    }
    return running.delete(threadId) ? threadId : null;
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
