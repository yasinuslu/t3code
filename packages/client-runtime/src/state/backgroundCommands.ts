import * as DateTime from "effect/DateTime";
import type { OrchestrationV2PendingBackgroundTask, TurnItemId } from "@t3tools/contracts";
import { isPullRequestWatchTaskId } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/** A background command or monitor a thread started, running or finished. */
export interface BackgroundCommand {
  readonly taskId: string;
  readonly kind: "command" | "monitor";
  /** The provider's description, or the command's first line. */
  readonly label: string;
  /** The command as the timeline item carries it; the server returns it unabridged. */
  readonly command: string | null;
  readonly running: boolean;
  /** Set when the provider keeps an output file for the task, which the server can read. */
  readonly hasTaskOutput: boolean;
  readonly itemId: TurnItemId | null;
  /** When the agent started it (ISO), or null when no item carries a start time. */
  readonly startedAt: string | null;
}

/** What the thread structure's turn items offer, which leaves out streamed text. */
interface BackgroundToolItem {
  readonly id: TurnItemId;
  readonly type: string;
  readonly nativeItemRef?: { readonly nativeId: string | null } | null;
  readonly input?: unknown;
  readonly monitor?: boolean | undefined;
  readonly backgroundTaskId?: string | undefined;
  readonly startedAt: DateTime.DateTime | null;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = Reflect.get(value, key);
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

/**
 * Every background command and monitor in a thread, newest first. A task is
 * running while its provider still lists it, and finished once it is gone. A
 * running task a provider lists without any tool item (work started before the
 * item carried the task id) still shows, with only its description.
 */
export function deriveBackgroundCommands(input: {
  readonly turnItems: ReadonlyArray<BackgroundToolItem>;
  readonly pendingTasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
}): ReadonlyArray<BackgroundCommand> {
  const pending = new Map(input.pendingTasks.map((task) => [task.taskId, task] as const));
  const seen = new Set<string>();
  const commands: BackgroundCommand[] = [];
  const add = (command: BackgroundCommand) => {
    if (seen.has(command.taskId)) return;
    seen.add(command.taskId);
    commands.push(command);
  };

  // Walk the items backwards for newest first; Hermes has no `toReversed`.
  for (let index = input.turnItems.length - 1; index >= 0; index -= 1) {
    const item = input.turnItems[index]!;
    if (item.type !== "command_execution" && item.type !== "dynamic_tool") continue;
    // Only the Claude adapter names a finished task; elsewhere a command that is not pending
    // is an ordinary tool call, not background work.
    const taskId =
      item.backgroundTaskId ?? pending.get(item.nativeItemRef?.nativeId || item.id)?.taskId;
    if (taskId === undefined) continue;
    const task = pending.get(taskId);
    if (task?.kind === "subagent") continue;
    add(fromItem(item, taskId, task));
  }
  for (const task of input.pendingTasks) {
    if (task.kind === "subagent" || isPullRequestWatchTaskId(task.taskId)) continue;
    add({
      taskId: task.taskId,
      kind: task.kind === "monitor" ? "monitor" : "command",
      label: task.description ?? (task.kind === "monitor" ? "monitor" : "command"),
      command: null,
      running: true,
      hasTaskOutput: false,
      itemId: null,
      startedAt: null,
    });
  }
  return commands;
}

function fromItem(
  item: BackgroundToolItem,
  taskId: string,
  task: OrchestrationV2PendingBackgroundTask | undefined,
): BackgroundCommand {
  const command =
    item.type === "command_execution"
      ? typeof item.input === "string"
        ? item.input
        : null
      : (stringField(item.input, "command") ?? null);
  const kind =
    item.type === "dynamic_tool" || (item.type === "command_execution" && item.monitor === true)
      ? "monitor"
      : "command";
  const description =
    task?.description ??
    (item.type === "dynamic_tool" ? stringField(item.input, "description") : undefined);
  return {
    taskId,
    kind,
    label: description ?? (command === null ? kind : firstLine(command) || kind),
    command,
    running: task !== undefined,
    hasTaskOutput: item.backgroundTaskId !== undefined,
    itemId: item.id,
    startedAt: item.startedAt === null ? null : DateTime.formatIso(item.startedAt),
  };
}

/** "Running", "Exited 0", "Failed, exit 2", or "Finished" when the exit is unknown. */
export function backgroundCommandStatusLabel(input: {
  readonly running: boolean;
  readonly exitCode: number | undefined;
}): string {
  if (input.running) return "Running";
  if (input.exitCode === undefined) return "Finished";
  return input.exitCode === 0 ? "Exited 0" : `Failed, exit ${input.exitCode}`;
}
