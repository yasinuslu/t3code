// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  BACKGROUND_TASK_OUTPUT_TAIL_BYTES,
  readBackgroundTaskOutputTail,
  resolveBackgroundTaskOutputPath,
} from "./backgroundTaskOutput.ts";

const now = DateTime.makeUnsafe("2026-10-07T00:00:00.000Z");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function bashItem(output: string): Extract<OrchestrationV2TurnItem, { type: "command_execution" }> {
  return {
    id: TurnItemId.make("item"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "command_execution",
    input: "pnpm build",
    output,
    backgroundTaskId: "b1",
  };
}

function tasksDir(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "bg-task-output-"));
  dirs.push(dir);
  NodeFS.mkdirSync(NodePath.join(dir, "tasks"));
  return NodePath.join(dir, "tasks");
}

describe("background task output", () => {
  it("reads the file a Bash result names, and only for its own task id", async () => {
    const dir = tasksDir();
    const path = NodePath.join(dir, "b1.output");
    NodeFS.writeFileSync(path, "compiled 3 files\n");
    const item = bashItem(
      `Command running in background with ID: b1. Output is being written to: ${path}. You will be notified when it completes.`,
    );

    expect(await resolveBackgroundTaskOutputPath(item, "b1")).toBe(path);
    expect(await resolveBackgroundTaskOutputPath(item, "../b1")).toBeUndefined();
    expect(await readBackgroundTaskOutputTail(path)).toEqual({
      output: "compiled 3 files\n",
      outputBytes: 17,
      truncated: false,
    });
  });

  it("keeps the tail of a large file without a broken first character", async () => {
    const path = NodePath.join(tasksDir(), "b1.output");
    // "é" is two bytes, so the tail window starts inside one of them.
    const text = `${"é".repeat(BACKGROUND_TASK_OUTPUT_TAIL_BYTES)}DONE!`;
    NodeFS.writeFileSync(path, text);

    const tail = await readBackgroundTaskOutputTail(path);
    expect(tail.truncated).toBe(true);
    expect(tail.outputBytes).toBe(Buffer.byteLength(text));
    expect(tail.output?.endsWith("DONE!")).toBe(true);
    expect(tail.output?.startsWith("é")).toBe(true);
  });

  it("reads the exit code Claude appends when the command ends", async () => {
    const path = NodePath.join(tasksDir(), "b1.output");
    NodeFS.writeFileSync(path, "compiling\nerror: something broke\n\n[exited with code 3]\n");
    expect(await readBackgroundTaskOutputTail(path)).toMatchObject({
      output: "compiling\nerror: something broke",
      exitCode: 3,
    });
  });

  it("reports a missing file as no output", async () => {
    expect(await readBackgroundTaskOutputTail(NodePath.join(tasksDir(), "gone.output"))).toEqual({
      output: null,
      outputBytes: 0,
      truncated: false,
    });
  });
});
