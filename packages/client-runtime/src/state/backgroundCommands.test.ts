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

describe("deriveBackgroundCommands", () => {
  it("lists commands and monitors newest first, running while the provider lists them", () => {
    const turnItems: OrchestrationV2TurnItem[] = [
      bash(1, "build", "pnpm build"),
      bash(2, "server", "pnpm dev\n--port 3000"),
      monitor(3, "watch"),
      {
        ...base,
        id: TurnItemId.make("foreground"),
        ordinal: 4,
        type: "command_execution",
        input: "ls",
      },
    ];
    const commands = deriveBackgroundCommands({
      turnItems,
      pendingTasks: [
        { taskId: "server", kind: "command", description: "Start the dev server" },
        { taskId: "watch", kind: "monitor" },
        { taskId: "pull-request-watch:github.com/o/r#1", kind: "monitor", awaited: true },
        { taskId: "roster-only", kind: "command", description: "Started before items named it" },
        { taskId: "agent", kind: "subagent" },
      ],
    });
    expect(
      commands.map(({ taskId, kind, label, running, hasTaskOutput }) => ({
        taskId,
        kind,
        label,
        running,
        hasTaskOutput,
      })),
    ).toEqual([
      { taskId: "watch", kind: "monitor", label: "app errors", running: true, hasTaskOutput: true },
      {
        taskId: "server",
        kind: "command",
        label: "Start the dev server",
        running: true,
        hasTaskOutput: true,
      },
      {
        taskId: "build",
        kind: "command",
        label: "pnpm build",
        running: false,
        hasTaskOutput: true,
      },
      {
        taskId: "roster-only",
        kind: "command",
        label: "Started before items named it",
        running: true,
        hasTaskOutput: false,
      },
    ]);
    expect(commands.find((command) => command.taskId === "watch")?.command).toBe(
      "tail -f app.log | grep ERROR",
    );
    expect(commands.find((command) => command.taskId === "build")?.startedAt).toBe(
      "2026-06-20T00:00:00.000Z",
    );
  });

  it("labels outcomes with their exit code", () => {
    expect(backgroundCommandStatusLabel({ running: true, exitCode: undefined })).toBe("Running");
    expect(backgroundCommandStatusLabel({ running: false, exitCode: 0 })).toBe("Exited 0");
    expect(backgroundCommandStatusLabel({ running: false, exitCode: 1 })).toBe("Failed, exit 1");
    expect(backgroundCommandStatusLabel({ running: false, exitCode: undefined })).toBe("Finished");
  });
});
