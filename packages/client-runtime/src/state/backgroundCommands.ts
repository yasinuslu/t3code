import type {
  OrchestrationV2NotificationTask,
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2TurnItem,
  TurnItemId,
} from "@t3tools/contracts";

export type BackgroundCommandStatus = "running" | "completed" | "failed" | "stopped" | "ended";

/** A background command or monitor a thread started, running or finished. */
export interface BackgroundCommand {
  readonly taskId: string;
  readonly kind: "command" | "monitor";
  /** The provider's description, or the command's first line. */
  readonly label: string;
  /** The command as the timeline item carries it; the server returns it unabridged. */
  readonly command: string | null;
  readonly status: BackgroundCommandStatus;
  readonly exitCode: number | undefined;
  readonly itemId: TurnItemId;
}

type BackgroundToolItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "command_execution" | "dynamic_tool" }
>;

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
 * running while its provider still lists it, then takes the outcome its
 * completion notification reported, or `ended` when none arrived (for example
 * after a server restart).
 */
export function deriveBackgroundCommands(input: {
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly pendingTasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
}): ReadonlyArray<BackgroundCommand> {
  const pending = new Map(input.pendingTasks.map((task) => [task.taskId, task] as const));
  const results = new Map<string, OrchestrationV2NotificationTask>();
  const tools: BackgroundToolItem[] = [];
  for (const item of input.turnItems) {
    if (item.type === "notification") {
      for (const task of item.tasks ?? []) {
        // A monitor's "updated" events are progress, not its end.
        if (task.outcome !== "updated") results.set(task.taskId, task);
      }
    } else if (
      (item.type === "command_execution" || item.type === "dynamic_tool") &&
      item.backgroundTaskId !== undefined
    ) {
      tools.push(item);
    }
  }
  // Newest first. Hermes has no `toReversed`, so walk the items backwards.
  const newestFirst = tools.map((_, index) => tools[tools.length - 1 - index]!);
  return newestFirst.map((item): BackgroundCommand => {
    const taskId = item.backgroundTaskId!;
    const command =
      item.type === "command_execution" ? item.input : (stringField(item.input, "command") ?? null);
    const result = results.get(taskId);
    const description =
      pending.get(taskId)?.description ??
      result?.label ??
      (item.type === "dynamic_tool" ? stringField(item.input, "description") : undefined);
    const status: BackgroundCommandStatus = pending.has(taskId)
      ? "running"
      : result === undefined
        ? "ended"
        : result.outcome === "failed"
          ? "failed"
          : result.outcome === "cancelled"
            ? "stopped"
            : result.outcome === "completed"
              ? "completed"
              : "ended";
    const kind = item.type === "dynamic_tool" ? "monitor" : "command";
    return {
      taskId,
      kind,
      label: description ?? (command === null ? kind : firstLine(command) || kind),
      command,
      status,
      exitCode: result?.exitCode,
      itemId: item.id,
    };
  });
}

/** "Running", "Exited 0", "Failed, exit 2", "Stopped", or "Ended". */
export function backgroundCommandStatusLabel(
  command: Pick<BackgroundCommand, "status" | "exitCode">,
): string {
  switch (command.status) {
    case "running":
      return "Running";
    case "completed":
      return command.exitCode === undefined ? "Done" : `Exited ${command.exitCode}`;
    case "failed":
      return command.exitCode === undefined ? "Failed" : `Failed, exit ${command.exitCode}`;
    case "stopped":
      return "Stopped";
    case "ended":
      return "Ended";
  }
}
