import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type WorkGroup,
  type WorkReason,
  classifyWorkThread,
  threadLastActivityAt,
} from "@t3tools/client-runtime/state/work-overview";
import {
  GROW_STAGES,
  type GrowCard,
  type GrowStage,
  type GrowUpdateInput,
  growStageOf,
} from "@t3tools/contracts";

export type GrowPatch = Omit<GrowUpdateInput, "threadId">;

/** A button on a card in some stage; `patch` is what pressing it records. */
export interface GrowAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly patch: GrowPatch;
}

export interface GrowStageDef {
  readonly title: string;
  /** A column of the board, or the Shelf strip under it. */
  readonly lane: "column" | "shelf";
  /** The user's turn: the card waits for them. */
  readonly yourTurn: boolean;
  /** Shown in an empty column. */
  readonly empty: string;
  /** What the user can do next from this stage. */
  readonly actions: ReadonlyArray<GrowAction>;
}

/**
 * Everything the board knows about each stage: its title, lane and actions.
 * Adding, renaming or reordering a stage starts here (and the id list in
 * contracts' grow.ts, which also holds the rules that derive a stage from a
 * thread, `growStageOf`, shared with the server's grow_board tool).
 */
export const GROW_STAGE_DEFS: Readonly<Record<GrowStage, GrowStageDef>> = {
  idea: {
    title: "Idea",
    lane: "column",
    yourTurn: false,
    empty: "Tell the manager an idea to start one",
    actions: [],
  },
  exploring: {
    title: "Exploring",
    lane: "column",
    yourTurn: false,
    empty: "Nothing being built",
    actions: [],
  },
  play: {
    title: "Play",
    lane: "column",
    yourTurn: true,
    empty: "Nothing to try yet",
    actions: [{ label: "Done playing, regroup", primary: true, patch: { stage: "regroup" } }],
  },
  regroup: {
    title: "Regroup",
    lane: "column",
    yourTurn: true,
    empty: "Nothing to decide",
    actions: [
      { label: "Adopt into main", primary: true, patch: { decision: "adopt" } },
      { label: "Pivot", patch: { decision: "pivot" } },
      { label: "Shelve", patch: { decision: "shelve" } },
    ],
  },
  building: {
    title: "Building on main",
    lane: "column",
    yourTurn: false,
    empty: "Nothing adopted",
    actions: [{ label: "Back to regroup", patch: { stage: "regroup", decision: null } }],
  },
  done: {
    title: "In use",
    lane: "column",
    yourTurn: false,
    empty: "Nothing merged yet",
    actions: [],
  },
  shelved: {
    title: "Shelf",
    lane: "shelf",
    yourTurn: false,
    empty: "Shelved ideas wait here.",
    actions: [{ label: "Bring it back", primary: true, patch: { stage: null, decision: null } }],
  },
};

export const GROW_COLUMN_STAGES = GROW_STAGES.filter(
  (stage) => GROW_STAGE_DEFS[stage].lane === "column",
);

export const IN_USE_LIMIT = 8;

export interface GrowBoardCard {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly card: GrowCard | undefined;
  readonly stage: GrowStage;
  readonly reason: WorkReason;
  readonly lastActivityAt: string;
  readonly playUrl: string | null;
}

export type GrowBoard = Readonly<Record<GrowStage, ReadonlyArray<GrowBoardCard>>>;

export const growCardKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  `${thread.environmentId}:${thread.id}`;

/** Facts the stage derives from, read off the thread and its work classification. */
function boardCardOf(
  thread: EnvironmentThreadShell,
  card: GrowCard | undefined,
  item: { readonly group: WorkGroup; readonly reason: WorkReason },
): GrowBoardCard {
  const previewLinks = thread.previewLinks ?? [];
  const stage = growStageOf(card, {
    hasPlayable: previewLinks.length > 0,
    working: item.group === "working",
    merged: thread.pullRequests.some((pullRequest) => pullRequest.snapshot?.state === "merged"),
    settled: item.reason === "settled",
  });
  return {
    key: growCardKey(thread),
    thread,
    card,
    stage,
    reason: item.reason,
    lastActivityAt: threadLastActivityAt(thread),
    playUrl: previewLinks[0]?.url ?? null,
  };
}

const epochMs = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Every thread becomes a card. Unlike the work overview, long-settled threads
 * stay on the board (as settled), so In use and the Shelf can show them.
 */
export function buildGrowBoard(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  cards: ReadonlyMap<string, GrowCard>,
  now: number,
): GrowBoard {
  const columns: Record<GrowStage, GrowBoardCard[]> = {
    idea: [],
    exploring: [],
    play: [],
    regroup: [],
    building: [],
    done: [],
    shelved: [],
  };
  for (const thread of threads) {
    if (
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.lineage.relationshipToParent === "subagent"
    ) {
      continue;
    }
    const placement =
      classifyWorkThread(thread, now) ??
      (thread.settledOverride === "settled"
        ? ({ group: "done", reason: "settled" } as const)
        : null);
    if (placement === null) continue;
    const entry = boardCardOf(thread, cards.get(growCardKey(thread)), placement);
    columns[entry.stage].push(entry);
  }
  for (const stage of Object.keys(columns) as GrowStage[]) {
    columns[stage].sort(
      (left, right) => epochMs(right.lastActivityAt) - epochMs(left.lastActivityAt),
    );
  }
  columns.done = columns.done.slice(0, IN_USE_LIMIT);
  return columns;
}
