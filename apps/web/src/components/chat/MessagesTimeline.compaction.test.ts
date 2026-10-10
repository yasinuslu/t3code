import { describe, expect, it } from "vite-plus/test";
import type { TimelineEntry } from "../../session-logic";
import { deriveMessagesTimelineRows, latestCompactionBoundary } from "./MessagesTimeline.logic";

let clock = 0;
function at() {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 10, 0, 0, clock)).toISOString();
}

function message(id: string, role: "user" | "assistant", runId: string | null): TimelineEntry {
  const createdAt = at();
  return {
    id: `${id}-entry`,
    kind: "message",
    createdAt,
    message: {
      id: id as never,
      role,
      text: id,
      runId: runId as never,
      createdAt,
      updatedAt: createdAt,
      streaming: false,
    },
  };
}

function compaction(
  id: string,
  runId: string,
  status: "completed" | "inProgress" = "completed",
): TimelineEntry {
  const createdAt = at();
  return {
    id: `${id}-entry`,
    kind: "work",
    createdAt,
    entry: {
      id,
      createdAt,
      label: "Context compacted",
      tone: "info",
      runId: runId as never,
      toolLifecycleStatus: status,
      sourceActivityKind: "context-compaction",
    },
  };
}

function messageIds(rows: ReturnType<typeof deriveMessagesTimelineRows>) {
  return rows.flatMap((row) => (row.kind === "message" ? [String(row.message.id)] : []));
}

function rowsFor(timelineEntries: TimelineEntry[], compactedHistoryExpanded = false) {
  return deriveMessagesTimelineRows({
    timelineEntries,
    isWorking: false,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    expandedRunIds: new Set(["run-1", "run-2", "run-3", "run-4"] as never[]),
    compactedHistoryExpanded,
  });
}

describe("compacted history", () => {
  const entries = [
    message("user-1", "user", null),
    message("assistant-1", "assistant", "run-1"),
    compaction("compaction-1", "run-1"),
    message("user-2", "user", null),
    message("assistant-2", "assistant", "run-2"),
    message("compact-command", "user", null),
    compaction("compaction-2", "run-3"),
    message("user-4", "user", null),
    message("assistant-4", "assistant", "run-4"),
  ];
  const allMessageIds = entries.flatMap((entry) =>
    entry.kind === "message" ? [String(entry.message.id)] : [],
  );

  it("collapses only what precedes the latest compaction, and loses nothing", () => {
    const boundary = latestCompactionBoundary(entries);
    expect(boundary).toMatchObject({ cutIndex: 5, compactionEntryId: "compaction-2-entry" });

    const collapsed = rowsFor(entries);
    const visible = messageIds(collapsed);
    expect(visible).toEqual(["compact-command", "user-4", "assistant-4"]);
    expect(collapsed[0]).toMatchObject({
      kind: "compacted-history",
      hiddenMessageCount: 4,
      expanded: false,
    });
    // Hidden plus visible is every message, each exactly once.
    expect(boundary!.hiddenMessageCount + visible.length).toBe(allMessageIds.length);

    const expanded = rowsFor(entries, true);
    expect(messageIds(expanded)).toEqual(allMessageIds);
    const toggleIndex = expanded.findIndex((row) => row.kind === "compacted-history");
    expect(expanded[toggleIndex]).toMatchObject({ expanded: true });
    expect(messageIds(expanded.slice(toggleIndex))).toEqual(visible);
  });

  it("keeps a turn that compacted midway whole", () => {
    const midTurn = [
      message("user-1", "user", null),
      message("assistant-1", "assistant", "run-1"),
      message("user-2", "user", null),
      message("assistant-2a", "assistant", "run-2"),
      compaction("auto-compaction", "run-2"),
      message("assistant-2b", "assistant", "run-2"),
    ];
    expect(latestCompactionBoundary(midTurn)).toMatchObject({ cutIndex: 2, hiddenMessageCount: 2 });
    expect(messageIds(rowsFor(midTurn))).toEqual(["user-2", "assistant-2a", "assistant-2b"]);
  });

  it("ignores a compaction that is still running and one with nothing before it", () => {
    const running = [
      message("user-1", "user", null),
      message("assistant-1", "assistant", "run-1"),
      message("user-2", "user", null),
      compaction("compaction", "run-2", "inProgress"),
    ];
    expect(latestCompactionBoundary(running)).toBeNull();
    expect(
      latestCompactionBoundary([message("user-1", "user", null), compaction("c", "run-1")]),
    ).toBeNull();
  });
});
