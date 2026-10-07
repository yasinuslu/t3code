// @effect-diagnostics nodeBuiltinImport:off
/**
 * Reads what a provider background task printed, for the background command
 * details view.
 *
 * Claude writes each background Bash command's and Monitor's output to
 * `<tmp>/claude-<uid>/<cwd slug>/<session id>/tasks/<task id>.output` and
 * keeps the file after the task ends. A Bash result names that path; a Monitor
 * result does not, so the file is otherwise found by its task id under the
 * Claude temp roots. Only a file named for a task id that one of the thread's
 * own tool items carries is ever read.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  OrchestrationV2GetBackgroundTaskOutputResult,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";

/** Enough to read a long build log's ending; the view polls this while the task runs. */
export const BACKGROUND_TASK_OUTPUT_TAIL_BYTES = 64 * 1024;

// Claude task ids are short alphanumeric strings; anything else never names a file.
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type BackgroundTaskToolItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "command_execution" | "dynamic_tool" }
>;

export function findBackgroundTaskItem(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  taskId: string,
): BackgroundTaskToolItem | undefined {
  return items.find(
    (item): item is BackgroundTaskToolItem =>
      (item.type === "command_execution" || item.type === "dynamic_tool") &&
      item.backgroundTaskId === taskId,
  );
}

/** The command a background task runs: a Bash item's input, or a Monitor's `command`. */
export function backgroundTaskCommand(item: BackgroundTaskToolItem): string | null {
  if (item.type === "command_execution") return item.input;
  const input = item.input;
  if (typeof input !== "object" || input === null) return null;
  const command = Reflect.get(input, "command");
  return typeof command === "string" ? command : null;
}

function outputPathFromItem(item: BackgroundTaskToolItem, taskId: string): string | undefined {
  const text = item.type === "command_execution" ? item.output : undefined;
  if (text === undefined) return undefined;
  const suffix = `/tasks/${taskId}.output`;
  const end = text.indexOf(suffix);
  if (end < 0) return undefined;
  const start = text.lastIndexOf(" ", end) + 1;
  const path = text.slice(start, end + suffix.length);
  return NodePath.isAbsolute(path) ? path : undefined;
}

async function readDirNames(dir: string): Promise<ReadonlyArray<string>> {
  try {
    return await NodeFSP.readdir(dir);
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await NodeFSP.stat(path)).isFile();
  } catch {
    return false;
  }
}

async function searchClaudeTaskOutput(taskId: string): Promise<string | undefined> {
  const tmpRoots = [...new Set([NodeOS.tmpdir(), "/tmp"])];
  for (const tmpRoot of tmpRoots) {
    for (const userDir of await readDirNames(tmpRoot)) {
      if (!userDir.startsWith("claude-")) continue;
      const userRoot = NodePath.join(tmpRoot, userDir);
      for (const project of await readDirNames(userRoot)) {
        for (const session of await readDirNames(NodePath.join(userRoot, project))) {
          const candidate = NodePath.join(userRoot, project, session, "tasks", `${taskId}.output`);
          if (await isFile(candidate)) return candidate;
        }
      }
    }
  }
  return undefined;
}

/** Locates a task's output file; undefined when the task id is invalid or the file is gone. */
export async function resolveBackgroundTaskOutputPath(
  item: BackgroundTaskToolItem,
  taskId: string,
): Promise<string | undefined> {
  if (!TASK_ID_PATTERN.test(taskId)) return undefined;
  const named = outputPathFromItem(item, taskId);
  if (named !== undefined && (await isFile(named))) return named;
  return searchClaudeTaskOutput(taskId);
}

// Claude appends "[exited with code N]" when a background command ends.
const EXIT_LINE_PATTERN = /\n?\[exited with code (-?\d+)\]\s*$/;

/** Splits the exit line Claude appends from the output it ends. */
export function splitBackgroundTaskExit(output: string): {
  readonly output: string;
  readonly exitCode?: number;
} {
  const match = EXIT_LINE_PATTERN.exec(output);
  if (match === null) return { output };
  return { output: output.slice(0, match.index).trimEnd(), exitCode: Number(match[1]) };
}

// A tail read can start inside a multi-byte character; skip its continuation bytes.
function dropLeadingContinuationBytes(buffer: Buffer): Buffer {
  let start = 0;
  while (start < buffer.length && start < 4 && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start);
}

/** The last {@link BACKGROUND_TASK_OUTPUT_TAIL_BYTES} of an output file, or null when unreadable. */
export async function readBackgroundTaskOutputTail(
  path: string,
): Promise<
  Pick<
    OrchestrationV2GetBackgroundTaskOutputResult,
    "output" | "outputBytes" | "truncated" | "exitCode"
  >
> {
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(path, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return { output: null, outputBytes: 0, truncated: false };
    const length = Math.min(stat.size, BACKGROUND_TASK_OUTPUT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, stat.size - length);
    const truncated = stat.size > length;
    const bytes = buffer.subarray(0, bytesRead);
    const text = (truncated ? dropLeadingContinuationBytes(bytes) : bytes).toString("utf8");
    return { ...splitBackgroundTaskExit(text), outputBytes: stat.size, truncated };
  } catch {
    return { output: null, outputBytes: 0, truncated: false };
  } finally {
    await handle?.close();
  }
}
