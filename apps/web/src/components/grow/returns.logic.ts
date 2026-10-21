import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type WorkReason,
  classifyWorkThread,
  threadLastActivityAt,
} from "@t3tools/client-runtime/state/work-overview";
import type { GrowCard } from "@t3tools/contracts";

/**
 * Grow is the return path: what the agents made comes back here, one thing at
 * a time, until the user decides on it. Everything is read off data threads
 * already have (previews, pull requests, status reports, run state); the only
 * thing Grow records is the user's decision, in the thread's grow card.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Agents return dozens of things a day, so the deck is today's: older returns
 * fold into "earlier", and after two weeks they leave the deck (the thread
 * list still has them, and a let-go one can come back as a spark).
 */
export const FRESH_WINDOW_MS = DAY_MS;
export const DECK_WINDOW_MS = 14 * DAY_MS;
/** "Done" lists what merged, shipped or was marked done in this window. */
export const SHIPPED_WINDOW_MS = 7 * DAY_MS;

export type ReturnKind =
  /** Blocked on the user: an approval, a question, a failure. */
  | "urgent"
  /** Finished, with something to open or a report, and undecided. */
  | "return"
  /** Merged, or the user said ship and it is on its way. */
  | "shipped"
  /** The user let it go; findable, and the pile sparks come from. */
  | "letGo"
  /** An agent is on it right now, after a What if or anything else. */
  | "working";

export interface GrowReturn {
  readonly key: string;
  readonly kind: ReturnKind;
  readonly thread: EnvironmentThreadShell;
  readonly card: GrowCard | undefined;
  readonly reason: WorkReason | null;
  readonly lastActivityAt: string;
  /** When the user last wrote to it (their own words, not another agent's); else its last activity. */
  readonly touchedAt: string;
  /** What to call it: what the agent named its preview, else the thread's title. */
  readonly headline: string;
  /** The newest preview the thread linked. */
  readonly playUrl: string | null;
  readonly pullRequest: GrowReturnPullRequest | null;
  /** Shipped: merged for real, rather than asked to ship. */
  readonly merged: boolean;
  /** There is work to land: an open pull request, or changes with none yet (not a report). */
  readonly shippable: boolean;
}

export interface GrowReturnPullRequest {
  readonly url: string;
  readonly number: number;
  readonly state: "open" | "merged" | "closed" | null;
}

export interface GrowDeck {
  readonly urgent: ReadonlyArray<GrowReturn>;
  /** Fresh returns, grouped by project (the project with the newest one first). */
  readonly returns: ReadonlyArray<GrowReturn>;
  readonly older: ReadonlyArray<GrowReturn>;
  readonly shipped: ReadonlyArray<GrowReturn>;
  readonly letGo: ReadonlyArray<GrowReturn>;
  /** Running now, so a What if stays findable while its answer is made. */
  readonly working: ReadonlyArray<GrowReturn>;
}

export const growReturnKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  `${thread.environmentId}:${thread.id}`;

export const growProjectKey = (
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
) => `${thread.environmentId}:${thread.projectId}`;

const epochMs = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Labels that say nothing about the thing: the title says more. */
const GENERIC_LABEL =
  /^(önizleme|onizleme|preview|demo|open|play|try( it)?|app|link|site|report|rapor|url)$/i;

const URL_PATTERN = /https?:\/\/\S+/g;

/** A title or label without the agent's plumbing: `(?demo=...)` ids and bare URLs. */
export function cleanLabel(text: string): string {
  const cleaned = text
    .replace(/\s*\((\?demo=|https?:\/\/)[^)]*\)/g, "")
    .replace(URL_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned === "" ? text : cleaned;
}

/** The last time the user themselves wrote to the thread; a manager sending on their behalf does not count. */
export function growTouchedAt(thread: EnvironmentThreadShell, fallback: string): string {
  const words = thread.latestUserAuthoredMessageAt ?? thread.latestUserMessageAt;
  return words ? String(words) : fallback;
}

export function growHeadline(thread: EnvironmentThreadShell): string {
  const label = latestPreview(thread)?.label?.trim();
  if (label && !GENERIC_LABEL.test(label) && !/^https?:\/\//.test(label)) return cleanLabel(label);
  return cleanLabel(thread.title);
}

/** Reports are read, not merged. */
const isReport = (thread: EnvironmentThreadShell) =>
  /^report\b/i.test(thread.title) || /^https?:\/\/reports\./.test(latestPreview(thread)?.url ?? "");

/**
 * What the big button does: answer the agent's question, ship work that can
 * land, or mark done what has nothing to merge (a report, a closed pull request).
 */
export function growPrimary(item: GrowReturn, hasQuestion: boolean): "reply" | "ship" | "done" {
  if (hasQuestion) return "reply";
  return item.shippable ? "ship" : "done";
}

const latestPreview = (thread: EnvironmentThreadShell) => thread.previewLinks?.at(-1);

function pullRequestOf(thread: EnvironmentThreadShell): GrowReturnPullRequest | null {
  const links = thread.pullRequests.filter((link) => link.source !== "stack-dismissed");
  const link = links.find((candidate) => candidate.snapshot?.state === "merged") ?? links.at(-1);
  if (link === undefined) return null;
  return { url: link.url, number: link.number, state: link.snapshot?.state ?? null };
}

/**
 * Managers (current and former) and brainstorm chats are made by the server on
 * the user's behalf; no other thread has that origin, so it marks them for good.
 */
const isServerMadeThread = (thread: Pick<EnvironmentThreadShell, "createdBy" | "creationSource">) =>
  thread.creationSource === "server" && thread.createdBy === "user";

const isSettled = (thread: EnvironmentThreadShell) =>
  thread.settledOverride === "settled" ||
  (thread.settledAt !== null && thread.settledOverride !== "active");

/**
 * A decision holds until the user writes to the thread again: Grow records it
 * after its own message, so only a later word from the user reopens it. The
 * agent finishing the work it was sent off with does not.
 */
export function heldDecision(
  thread: EnvironmentThreadShell,
  card: GrowCard | undefined,
): GrowCard["decision"] | undefined {
  if (card?.decision === undefined) return undefined;
  const lastWord = thread.latestUserAuthoredMessageAt ?? thread.latestUserMessageAt;
  return epochMs(card.updatedAt) >= epochMs(lastWord) ? card.decision : undefined;
}

export interface GrowDeckOptions {
  /** Keys (`envId:threadId`) that never show: the managers, of every space. */
  readonly excluded?: ReadonlySet<string>;
  /** Keys the user just decided on, still inside their undo window. */
  readonly pending?: ReadonlySet<string>;
  /** How the fresh returns are laid out: kept together by project (default), or flat, newest first. */
  readonly grouping?: "projects" | "recent";
}

export function buildGrowDeck(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  cards: ReadonlyMap<string, GrowCard>,
  now: number,
  options: GrowDeckOptions = {},
): GrowDeck {
  const urgent: GrowReturn[] = [];
  const fresh: GrowReturn[] = [];
  const older: GrowReturn[] = [];
  const shipped: GrowReturn[] = [];
  const letGo: GrowReturn[] = [];
  const working: GrowReturn[] = [];
  for (const thread of threads) {
    const key = growReturnKey(thread);
    if (
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.lineage.relationshipToParent === "subagent" ||
      isServerMadeThread(thread) ||
      options.excluded?.has(key) === true ||
      options.pending?.has(key) === true
    ) {
      continue;
    }
    const placement = classifyWorkThread(thread, now);
    const card = cards.get(key);
    const pullRequest = pullRequestOf(thread);
    const merged = pullRequest?.state === "merged";
    const lastActivityAt = threadLastActivityAt(thread);
    const age = now - epochMs(lastActivityAt);
    const touchedAt = growTouchedAt(thread, lastActivityAt);
    const entry = (kind: ReturnKind): GrowReturn => ({
      key,
      kind,
      thread,
      card,
      reason: placement?.reason ?? null,
      lastActivityAt,
      touchedAt,
      headline: growHeadline(thread),
      playUrl: latestPreview(thread)?.url ?? null,
      pullRequest,
      merged,
      shippable:
        pullRequest === null
          ? !isReport(thread)
          : pullRequest.state === "open" || pullRequest.state === null,
    });
    if (placement?.group === "working") {
      working.push(entry("working"));
      continue;
    }
    const decision = heldDecision(thread, card);
    if (decision === "shelve" || decision === "pivot") {
      letGo.push(entry("letGo"));
      continue;
    }
    if (placement?.group === "needsMe") {
      urgent.push(entry("urgent"));
      continue;
    }
    if (merged || decision === "adopt") {
      if (age <= SHIPPED_WINDOW_MS) shipped.push(entry("shipped"));
      continue;
    }
    if (age > DECK_WINDOW_MS) continue;
    // Never started: nothing came back.
    if (thread.latestUserMessageAt === null && thread.latestRun === null) continue;
    // A settled thread returns only with something to open (a closed pull
    // request ended it); an unsettled one finished and is waiting either way.
    const openable =
      Boolean(thread.previewLinks?.length) ||
      (pullRequest !== null && pullRequest.state !== "closed");
    if (isSettled(thread) && !openable) continue;
    (age <= FRESH_WINDOW_MS ? fresh : older).push(entry("return"));
  }
  const newestFirst = (left: GrowReturn, right: GrowReturn) =>
    epochMs(right.lastActivityAt) - epochMs(left.lastActivityAt);
  const lastTouchedFirst = (left: GrowReturn, right: GrowReturn) =>
    epochMs(right.touchedAt) - epochMs(left.touchedAt);
  return {
    urgent: urgent.sort(lastTouchedFirst),
    returns:
      options.grouping === "recent"
        ? fresh.sort(lastTouchedFirst)
        : byProject(fresh.sort(lastTouchedFirst)),
    older: older.sort(lastTouchedFirst),
    shipped: shipped.sort(newestFirst),
    letGo: letGo.sort(newestFirst),
    working: working.sort(newestFirst),
  };
}

/** Last touched first, but a project's returns stay together, in the order of each project's most recent. */
function byProject(sorted: ReadonlyArray<GrowReturn>): GrowReturn[] {
  const groups = new Map<string, GrowReturn[]>();
  for (const item of sorted) {
    const project = growProjectKey(item.thread);
    const group = groups.get(project);
    if (group) group.push(item);
    else groups.set(project, [item]);
  }
  return [...groups.values()].flat();
}

/**
 * The thread this one came from: the one it was forked off, else the one the
 * manager recorded on its grow card. Subagents are left out, like in the deck.
 */
export function growParentKey(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "lineage">,
  card: GrowCard | undefined,
): string | null {
  const parentId =
    thread.lineage.relationshipToParent === "fork"
      ? thread.lineage.parentThreadId
      : (card?.parentThreadId ?? null);
  return parentId === null ? null : `${thread.environmentId}:${parentId}`;
}

export interface GrowRelations {
  readonly byKey: ReadonlyMap<string, EnvironmentThreadShell>;
  /** Threads that came from a thread, oldest first, by the parent's key. */
  readonly children: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
  /** Threads a thread superseded (they were let go in its favour), oldest first, by its key. */
  readonly supersedes: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
}

export function buildGrowRelations(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  cards: ReadonlyMap<string, GrowCard>,
): GrowRelations {
  const byKey = new Map<string, EnvironmentThreadShell>();
  const children = new Map<string, EnvironmentThreadShell[]>();
  const supersedes = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const key = growReturnKey(thread);
    byKey.set(key, thread);
    if (thread.supersededBy != null && thread.deletedAt === null) {
      const successor = `${thread.environmentId}:${thread.supersededBy.threadId}`;
      const older = supersedes.get(successor);
      if (older) older.push(thread);
      else supersedes.set(successor, [thread]);
    }
    if (thread.lineage.relationshipToParent === "subagent" || thread.deletedAt !== null) continue;
    const parent = growParentKey(thread, cards.get(key));
    if (parent === null) continue;
    const siblings = children.get(parent);
    if (siblings) siblings.push(thread);
    else children.set(parent, [thread]);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => epochMs(left.createdAt) - epochMs(right.createdAt));
  }
  for (const older of supersedes.values()) {
    older.sort((left, right) => epochMs(left.createdAt) - epochMs(right.createdAt));
  }
  return { byKey, children, supersedes };
}

/**
 * Where this thread's work went next: its successor, that one's successor, and
 * so on, nearest first. Bounded, and a thread seen twice ends the walk, so a
 * chain written by an older server can never loop the view.
 */
export function supersededChain(
  relations: Pick<GrowRelations, "byKey">,
  thread: EnvironmentThreadShell,
): ReadonlyArray<{ readonly thread: EnvironmentThreadShell; readonly note: string }> {
  const chain: Array<{ thread: EnvironmentThreadShell; note: string }> = [];
  const seen = new Set([growReturnKey(thread)]);
  let link = thread.supersededBy;
  while (link != null && chain.length < 8) {
    const key = `${thread.environmentId}:${link.threadId}`;
    const next = relations.byKey.get(key);
    if (next === undefined || seen.has(key)) break;
    seen.add(key);
    chain.push({ thread: next, note: link.note });
    link = next.supersededBy;
  }
  return chain;
}

/**
 * The threads that could carry this one's work on, best guesses first: the
 * ones it is related to (its parent, threads it led to, siblings), then the
 * same project, each by latest activity. Threads already in its own chain
 * behind it are left out, since picking one would loop. A query narrows the
 * list by title.
 */
export function supersedeCandidates(input: {
  readonly thread: EnvironmentThreadShell;
  readonly relations: GrowRelations;
  readonly parentKey: string | null;
  readonly query: string;
  readonly limit?: number;
}): ReadonlyArray<EnvironmentThreadShell> {
  const { thread, relations } = input;
  const self = growReturnKey(thread);
  const behind = new Set<string>([self]);
  const stack = [self];
  while (stack.length > 0) {
    for (const older of relations.supersedes.get(stack.pop()!) ?? []) {
      const key = growReturnKey(older);
      if (!behind.has(key)) {
        behind.add(key);
        stack.push(key);
      }
    }
  }
  const related = new Set<string>();
  if (input.parentKey !== null) {
    related.add(input.parentKey);
    for (const sibling of relations.children.get(input.parentKey) ?? []) {
      related.add(growReturnKey(sibling));
    }
  }
  for (const child of relations.children.get(self) ?? []) related.add(growReturnKey(child));
  const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (candidate: EnvironmentThreadShell) =>
    related.has(growReturnKey(candidate)) ? 0 : candidate.projectId === thread.projectId ? 1 : 2;
  return [...relations.byKey.values()]
    .filter(
      (candidate) =>
        candidate.environmentId === thread.environmentId &&
        candidate.deletedAt === null &&
        candidate.archivedAt === null &&
        candidate.lineage.relationshipToParent !== "subagent" &&
        // A superseded thread is not where the work lives on; its successor is.
        candidate.supersededBy === undefined &&
        !behind.has(growReturnKey(candidate)) &&
        words.every((word) => candidate.title.toLowerCase().includes(word)),
    )
    .sort(
      (left, right) =>
        rank(left) - rank(right) || epochMs(right.updatedAt) - epochMs(left.updatedAt),
    )
    .slice(0, input.limit ?? 6);
}

/** Everything the user is asked to decide, in the order the deck walks it. */
export function growQueue(deck: GrowDeck): ReadonlyArray<GrowReturn> {
  return [...deck.urgent, ...deck.returns, ...deck.older];
}

/** Every item the deck can show, the queue first. */
export function growDeckItems(deck: GrowDeck): ReadonlyArray<GrowReturn> {
  return [...deck.working, ...growQueue(deck), ...deck.shipped, ...deck.letGo];
}

/**
 * The one old idea worth another look when the queue is empty: the let-go
 * thing with something to play that has waited longest. Never more than one.
 */
export function growSpark(deck: GrowDeck): GrowReturn | null {
  const playable = deck.letGo.filter((item) => item.playUrl !== null);
  return playable.at(-1) ?? deck.letGo.at(-1) ?? null;
}

/** The items whose headline or title contains the query, case-insensitively. */
export function filterGrowDeck(deck: GrowDeck, query: string): GrowDeck {
  const needle = query.trim().toLowerCase();
  if (needle === "") return deck;
  const keep = (items: ReadonlyArray<GrowReturn>) =>
    items.filter(
      (item) =>
        item.headline.toLowerCase().includes(needle) ||
        item.thread.title.toLowerCase().includes(needle),
    );
  return {
    urgent: keep(deck.urgent),
    returns: keep(deck.returns),
    older: keep(deck.older),
    shipped: keep(deck.shipped),
    letGo: keep(deck.letGo),
    working: keep(deck.working),
  };
}

/** Which item the deck shows: the selected one while it is still there, else the first in the queue. */
export function growCurrent(deck: GrowDeck, selected: string | null): GrowReturn | null {
  return growDeckItems(deck).find((item) => item.key === selected) ?? growQueue(deck)[0] ?? null;
}

/** Where deciding on `key` moves to: the next one in the queue, else the one before it. */
export function growNextAfter(deck: GrowDeck, key: string): string | null {
  const queue = growQueue(deck).map((item) => item.key);
  const at = queue.indexOf(key);
  if (at < 0) return null;
  return queue[at + 1] ?? queue[at - 1] ?? null;
}

/** The queue item `direction` steps from `current`, stopping at both ends. */
export function growStep(deck: GrowDeck, current: string | null, direction: 1 | -1): string | null {
  const keys = growDeckItems(deck).map((item) => item.key);
  if (keys.length === 0) return null;
  const at = current === null ? -1 : keys.indexOf(current);
  if (at < 0) return keys[0] ?? null;
  return keys[Math.min(keys.length - 1, Math.max(0, at + direction))] ?? null;
}

/** What Ship sends the thread: the user's go-ahead to land it the way its repo lands work. */
/** Sent when an item came back with nothing to see: every return carries a proof image. */
export const PROOF_MESSAGE =
  "Show me proof. Add an image I understand at a glance to your status card with thread_status_update: a screenshot of the result with the change marked (a short GIF if it moves), or for work with nothing on screen, an image of the evidence. Nothing else changes.";

export const SHIP_MESSAGE =
  "Ship it. Land this the usual way for this repo: open the PR if there is none, get CI green, merge, verify it is live, then settle this thread. If something blocks the merge, tell me in one line.";

/** The project the shown item belongs to, wherever the deck lists it. */
export function growFocusedProject(deck: GrowDeck, key: string | null): string | null {
  if (key === null) return null;
  for (const section of [
    deck.working,
    deck.urgent,
    deck.returns,
    deck.older,
    deck.shipped,
    deck.letGo,
  ]) {
    const item = section.find((candidate) => candidate.key === key);
    if (item) return growProjectKey(item.thread);
  }
  return null;
}

/** Only the shown item's project is open by default; expanding all opens every project. */
export const growProjectOpen = (project: string, focused: string | null, expandAll: boolean) =>
  expandAll || project === focused;
