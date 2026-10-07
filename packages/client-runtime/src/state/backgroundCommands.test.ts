import { TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { v2Now, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { backgroundCommandStatusLabel, deriveBackgroundCommands } from "./backgroundCommands.ts";

const base = {
  threadId: v2ThreadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  title: null,
  startedAt: v2Now,
  completedAt: v2Now,
  updatedAt: v2Now,
  status: "completed",
} as const;

function bash(ordinal: number, taskId: string, input: string): OrchestrationV2TurnItem {
  return {
    ...base,
    id: TurnItemId.make(`bash-${ordinal}`),
    ordinal,
    type: "command_execution",
    input,
    backgroundTaskId: taskId,
  };
}

function monitor(ordinal: number, taskId: string): OrchestrationV2TurnItem {
  return {
    ...base,
    id: TurnItemId.make(`monitor-${ordinal}`),
    ordinal,
    type: "dynamic_tool",
    toolName: "Monitor",
    input: { command: "tail -f app.log | grep ERROR", description: "app errors" },
    backgroundTaskId: taskId,
  };
}

function notification(
  ordinal: number,
  tasks: NonNullable<Extract<OrchestrationV2TurnItem, { type: "notification" }>["tasks"]>,
): OrchestrationV2TurnItem {
  return {
    ...base,
    id: TurnItemId.make(`notification-${ordinal}`),
    ordinal,
    type: "notification",
    source: { kind: "command" },
    outcome: "completed",
    summary: "Command finished",
    tasks,
  };
}

describe("deriveBackgroundCommands", () => {
  it("pairs each command with its roster state and reported exit, newest first", () => {
    const commands = deriveBackgroundCommands({
      turnItems: [
        bash(1, "build", "pnpm build"),
        bash(2, "server", "pnpm dev\n--port 3000"),
        monitor(3, "watch"),
        bash(4, "lost", "sleep 600"),
        notification(5, [
          { taskId: "build", outcome: "failed", exitCode: 2, label: "Build the app" },
        ]),
        notification(6, [{ taskId: "watch", outcome: "updated" }]),
      ],
      pendingTasks: [
        { taskId: "server", kind: "command", description: "Start the dev server" },
        { taskId: "watch", kind: "monitor", description: "app errors" },
      ],
    });
    expect(
      commands.map(({ taskId, kind, label, status, exitCode }) => ({
        taskId,
        kind,
        label,
        status,
        exitCode,
      })),
    ).toEqual([
      // No roster entry and no completion notification: the provider lost it.
      { taskId: "lost", kind: "command", label: "sleep 600", status: "ended", exitCode: undefined },
      // A monitor's progress events do not end it.
      {
        taskId: "watch",
        kind: "monitor",
        label: "app errors",
        status: "running",
        exitCode: undefined,
      },
      {
        taskId: "server",
        kind: "command",
        label: "Start the dev server",
        status: "running",
        exitCode: undefined,
      },
      { taskId: "build", kind: "command", label: "Build the app", status: "failed", exitCode: 2 },
    ]);
    expect(commands.find((command) => command.taskId === "watch")?.command).toBe(
      "tail -f app.log | grep ERROR",
    );
  });

  it("labels outcomes with their exit code", () => {
    expect(backgroundCommandStatusLabel({ status: "completed", exitCode: 0 })).toBe("Exited 0");
    expect(backgroundCommandStatusLabel({ status: "failed", exitCode: 1 })).toBe("Failed, exit 1");
    expect(backgroundCommandStatusLabel({ status: "stopped", exitCode: undefined })).toBe(
      "Stopped",
    );
  });
});
