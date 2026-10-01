import { describe, expect, it } from "vite-plus/test";

import { deriveFailedCommandSummary, formatToolDuration } from "./ToolOutputBlock.logic";

describe("deriveFailedCommandSummary", () => {
  it("reads Claude's leading exit code and prefers the line that names the error", () => {
    expect(
      deriveFailedCommandSummary(
        "Exit code 3\nchecking inputs\nerror: widget.json is missing\nhint: run setup",
      ),
    ).toEqual({ exitCode: 3, firstErrorLine: "error: widget.json is missing" });
  });

  it("reads Codex's trailing exit marker and falls back to the first output line", () => {
    expect(
      deriveFailedCommandSummary("  \nsomething odd happened\n<exited with exit code 2>"),
    ).toEqual({
      exitCode: 2,
      firstErrorLine: "something odd happened",
    });
  });

  it("handles output without an exit code, empty output, and very long lines", () => {
    expect(deriveFailedCommandSummary("Permission denied")).toEqual({
      exitCode: null,
      firstErrorLine: "Permission denied",
    });
    expect(deriveFailedCommandSummary("Exit code 1")).toEqual({
      exitCode: 1,
      firstErrorLine: null,
    });
    expect(deriveFailedCommandSummary(null)).toEqual({ exitCode: null, firstErrorLine: null });
    const long = deriveFailedCommandSummary(`error: ${"x".repeat(400)}`).firstErrorLine;
    expect(long?.length).toBe(200);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("formatToolDuration", () => {
  it("formats the span between start and end, and nothing for missing or reversed spans", () => {
    expect(formatToolDuration("2026-09-29T10:00:00.000Z", "2026-09-29T10:00:01.500Z")).toBe("1.5s");
    expect(formatToolDuration("2026-09-29T10:00:00.000Z", "2026-09-29T10:00:00.040Z")).toBe("40ms");
    expect(formatToolDuration(undefined, "2026-09-29T10:00:00.040Z")).toBeNull();
    expect(formatToolDuration("2026-09-29T10:00:01.000Z", "2026-09-29T10:00:00.000Z")).toBeNull();
  });
});
