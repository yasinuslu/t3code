import { formatDuration } from "@t3tools/shared/orchestrationTiming";

export interface FailedCommandSummary {
  readonly exitCode: number | null;
  /** The line that best explains the failure, for the collapsed row. */
  readonly firstErrorLine: string | null;
}

const EXIT_CODE_LINE = /^(?:exit code:?\s*(\d+)|<exited with exit code (\d+)>)$/i;
const ERROR_WORDS =
  /\b(?:error|errors|fatal|fail|failed|failure|exception|panic|traceback|denied|cannot|can't|not found|no such)\b/i;
const FIRST_ERROR_LINE_CHARS = 200;

/**
 * Exit code and first error line of a failed command's output. Claude prefixes
 * a failed Bash result with "Exit code N"; Codex appends "<exited with exit
 * code N>". The error line prefers one that names an error over plain output.
 */
export function deriveFailedCommandSummary(
  output: string | null | undefined,
): FailedCommandSummary {
  let exitCode: number | null = null;
  const lines: string[] = [];
  for (const rawLine of (output ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const exit = EXIT_CODE_LINE.exec(line);
    if (exit) {
      exitCode ??= Number.parseInt(exit[1] ?? exit[2] ?? "", 10);
      continue;
    }
    lines.push(line);
  }
  const line = lines.find((candidate) => ERROR_WORDS.test(candidate)) ?? lines[0] ?? null;
  return {
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    firstErrorLine:
      line && line.length > FIRST_ERROR_LINE_CHARS
        ? `${line.slice(0, FIRST_ERROR_LINE_CHARS - 1)}…`
        : line,
  };
}

/** Duration between two ISO timestamps, or null when either is missing or invalid. */
export function formatToolDuration(
  startedAt: string | undefined | null,
  endedAt: string | undefined | null,
): string | null {
  if (!startedAt || !endedAt) return null;
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? formatDuration(durationMs) : null;
}

/**
 * Full outputs this client already fetched, by activity id. The Agents panel
 * search reads them so matches in expanded outputs count without refetching.
 */
const loadedToolOutputs = new Map<string, string>();
const LOADED_TOOL_OUTPUT_LIMIT = 500;

export function rememberLoadedToolOutput(activityId: string, output: string): void {
  loadedToolOutputs.delete(activityId);
  loadedToolOutputs.set(activityId, output);
  if (loadedToolOutputs.size > LOADED_TOOL_OUTPUT_LIMIT) {
    const oldest = loadedToolOutputs.keys().next().value;
    if (oldest !== undefined) loadedToolOutputs.delete(oldest);
  }
}

export function loadedToolOutput(activityId: string): string | undefined {
  return loadedToolOutputs.get(activityId);
}
