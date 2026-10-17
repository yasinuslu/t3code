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
      { label: "Back to play", patch: { stage: "play", decision: null } },
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

/** The chat never gets narrower than this (22rem), and the board keeps this much beside its chat. */
export const GROW_CHAT_MIN = 352;
export const GROW_BOARD_MIN = 440;

export interface GrowPaneWidths {
  readonly rail: number;
  readonly thing: number;
  readonly boardChat: number;
}

/**
 * The widths Grow actually lays out, from the stored preferences and the
 * window: the thing pane shrinks first, then the rail, down to their minimums.
 * When even that leaves the chat under its minimum, the thing pane is dropped
 * (`showThing` false) and the rail keeps what the chat leaves. The stored
 * preferences are never rewritten by this; a wider window gets them back.
 */
export function growLayoutWidths(
  stored: GrowPaneWidths,
  total: number,
  mins: GrowPaneWidths,
): GrowPaneWidths & { readonly showThing: boolean } {
  const room = total - GROW_CHAT_MIN;
  let rail = Math.max(mins.rail, stored.rail);
  let thing = Math.max(mins.thing, stored.thing);
  let over = rail + thing - room;
  if (over > 0) {
    const cut = Math.min(over, thing - mins.thing);
    thing -= cut;
    over -= cut;
  }
  if (over > 0) {
    const cut = Math.min(over, rail - mins.rail);
    rail -= cut;
    over -= cut;
  }
  const showThing = over <= 0;
  if (!showThing) rail = Math.max(mins.rail, Math.min(stored.rail, room));
  const boardChat = Math.max(mins.boardChat, Math.min(stored.boardChat, total - GROW_BOARD_MIN));
  return { rail, thing, boardChat, showThing };
}

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

/** The project a thread belongs to, `envId:projectId`; the project filter's value. */
export const growProjectKey = (
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
) => `${thread.environmentId}:${thread.projectId}`;

/**
 * Managers (current and former) and brainstorm chats are made by the server on
 * the user's behalf; no other thread has that origin, so it marks them for good,
 * unlike the store's set of current managers.
 */
const isServerMadeThread = (thread: Pick<EnvironmentThreadShell, "createdBy" | "creationSource">) =>
  thread.creationSource === "server" && thread.createdBy === "user";

export interface GrowBoardOptions {
  /** Keys (`envId:threadId`) that are never cards: the managers, of every space. */
  readonly excluded?: ReadonlySet<string>;
  /** Only this project's threads; null or absent: all. */
  readonly project?: string | null;
  /** How many In use cards to keep; the play report passes `Infinity` to count them all. */
  readonly inUseLimit?: number;
}

/**
 * Every thread becomes a card. Unlike the work overview, long-settled threads
 * stay on the board (as settled), so In use and the Shelf can show them.
 * Managers are never cards, whichever space or machine they belong to.
 */
export function buildGrowBoard(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  cards: ReadonlyMap<string, GrowCard>,
  now: number,
  options: GrowBoardOptions = {},
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
      thread.lineage.relationshipToParent === "subagent" ||
      isServerMadeThread(thread) ||
      options.excluded?.has(growCardKey(thread)) === true ||
      (options.project != null && growProjectKey(thread) !== options.project)
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
  columns.done = columns.done.slice(0, options.inUseLimit ?? IN_USE_LIMIT);
  return columns;
}

/**
 * The board as it is drawn: one built without an In use limit, cut to it. The
 * `keep` card (the selection, which the play report can reach among the
 * older ones) stays so that picking it shows it.
 */
export function limitInUse(board: GrowBoard, keep: string): GrowBoard {
  if (board.done.length <= IN_USE_LIMIT) return board;
  const kept = board.done.slice(0, IN_USE_LIMIT);
  const extra = board.done.slice(IN_USE_LIMIT).find((card) => card.key === keep);
  return { ...board, done: extra === undefined ? kept : [...kept, extra] };
}

/** What a thread made that the owner can open: its first preview or report link, else its first pull request. */
export interface GrowOpenable {
  readonly url: string;
  readonly label: string;
}

export function growOpenableOf(thread: EnvironmentThreadShell): GrowOpenable | null {
  const preview = thread.previewLinks?.[0];
  if (preview !== undefined) {
    return { url: preview.url, label: preview.label ?? preview.url.replace(/^https?:\/\//, "") };
  }
  const pullRequest = thread.pullRequests.find((link) => link.source !== "stack-dismissed");
  return pullRequest === undefined
    ? null
    : { url: pullRequest.url, label: `PR #${pullRequest.number}` };
}

export interface GrowPlayedCard {
  readonly card: GrowBoardCard;
  readonly openable: GrowOpenable;
}

/**
 * Whether threads produce something to open, read off a board built without
 * the In use limit: the cards with a preview, report link or pull request
 * (`played`), the open ones still without one (`stuck`, longest first), and
 * the ones that ended, settled or shelved, without (`ended`).
 */
export interface GrowPlayReport {
  readonly total: number;
  readonly played: ReadonlyArray<GrowPlayedCard>;
  readonly stuck: ReadonlyArray<GrowBoardCard>;
  readonly ended: ReadonlyArray<GrowBoardCard>;
}

export function growPlayReport(board: GrowBoard): GrowPlayReport {
  const played: GrowPlayedCard[] = [];
  const stuck: GrowBoardCard[] = [];
  const ended: GrowBoardCard[] = [];
  for (const stage of GROW_STAGES) {
    for (const card of board[stage]) {
      const openable = growOpenableOf(card.thread);
      if (openable !== null) played.push({ card, openable });
      else if (stage === "done" || stage === "shelved") ended.push(card);
      else stuck.push(card);
    }
  }
  stuck.sort((left, right) => epochMs(left.thread.createdAt) - epochMs(right.thread.createdAt));
  return { total: played.length + stuck.length + ended.length, played, stuck, ended };
}

/** The projects that have at least one card, in first-seen order. */
export function growBoardProjects(board: GrowBoard): ReadonlyArray<string> {
  return [
    ...new Set(
      GROW_STAGES.flatMap((stage) => board[stage].map((card) => growProjectKey(card.thread))),
    ),
  ];
}

/**
 * The cards whose title or "what it became" text contains the query, as the
 * sidebar's thread search matches titles: case-insensitive substring. A blank
 * query keeps everything.
 */
export function filterGrowBoard(board: GrowBoard, query: string): GrowBoard {
  const needle = query.trim().toLowerCase();
  if (needle === "") return board;
  const matches = (card: GrowBoardCard) =>
    card.thread.title.toLowerCase().includes(needle) ||
    (card.card?.became ?? "").toLowerCase().includes(needle);
  return Object.fromEntries(
    GROW_STAGES.map((stage) => [stage, board[stage].filter(matches)]),
  ) as unknown as GrowBoard;
}

/** Every card in rail order: stages in board order, Shelf last, newest first within a stage. */
export function growRailOrder(board: GrowBoard): ReadonlyArray<GrowBoardCard> {
  return GROW_STAGES.flatMap((stage) => board[stage]);
}

/** The selection that is the manager's chat rather than a card. */
export const GROW_MANAGER_KEY = "manager";

/** The selection that is shown: a card still on the board, else the manager. */
export function growEffectiveSelection(board: GrowBoard, selected: string): string {
  return growRailOrder(board).some((card) => card.key === selected) ? selected : GROW_MANAGER_KEY;
}

/**
 * Where j/k go: the manager first, then the rail in order, stopping at both
 * ends. A selection that left the board counts as the manager.
 */
export function growStepSelection(board: GrowBoard, selected: string, direction: 1 | -1): string {
  const keys = [GROW_MANAGER_KEY, ...growRailOrder(board).map((card) => card.key)];
  const index = Math.max(0, keys.indexOf(selected));
  return keys[Math.min(keys.length - 1, Math.max(0, index + direction))] ?? GROW_MANAGER_KEY;
}

export type GrowDirection = "up" | "down" | "left" | "right";

/**
 * Arrow stepping over the board: the non-empty columns left to right with the
 * Shelf as the last one. Up and down stay in a column (up from its first card
 * of the first column goes to the manager); left and right move to the next
 * column keeping the row where it can. From the manager, down or right enters
 * the first column. A selection that left the board counts as the manager.
 */
export function growBoardStep(
  board: GrowBoard,
  selected: string,
  direction: GrowDirection,
): string {
  const columns = [...GROW_COLUMN_STAGES, "shelved" as const]
    .map((stage) => board[stage])
    .filter((column) => column.length > 0);
  const first = columns[0]?.[0]?.key;
  const column = columns.findIndex((cards) => cards.some((card) => card.key === selected));
  if (column < 0) {
    return (direction === "down" || direction === "right" ? first : undefined) ?? GROW_MANAGER_KEY;
  }
  const cards = columns[column] ?? [];
  const row = cards.findIndex((card) => card.key === selected);
  if (direction === "up" || direction === "down") {
    if (direction === "up" && row === 0 && column === 0) return GROW_MANAGER_KEY;
    const next = Math.min(cards.length - 1, Math.max(0, row + (direction === "down" ? 1 : -1)));
    return cards[next]?.key ?? selected;
  }
  const target = columns[column + (direction === "right" ? 1 : -1)];
  if (target === undefined) return selected;
  return target[Math.min(row, target.length - 1)]?.key ?? selected;
}
