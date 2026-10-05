import type {
  BrainstormSpace,
  BrainstormSyncSpacesInput,
  BrainstormTask,
  BrainstormTaskList,
  ModelSelection,
} from "@t3tools/contracts";

import { ALL_SPACE_ID, OTHER_SPACE_ID, type Space, type SpaceState } from "../../spaceStore";

/** Tasks above every goal heading, and tasks under a written `## Inbox`. */
export const INBOX_GOAL = "Inbox";

/** The client's spaces as the server mirrors them for the brainstorm tools. */
export function brainstormSpacesInput(
  state: Pick<SpaceState, "spaces" | "customSpaceIdsByProjectKey">,
  environmentId: string,
  defaultProfile: string | null = null,
): BrainstormSyncSpacesInput {
  const spaces: BrainstormSpace[] = state.spaces.map((space: Space) => ({
    id: space.id,
    name: space.name,
    kind:
      space.id === ALL_SPACE_ID
        ? "all"
        : space.id === OTHER_SPACE_ID
          ? "other"
          : space.profile !== null
            ? "profile"
            : "custom",
    profile: space.profile,
  }));
  const prefix = `${environmentId}:`;
  const customSpaceIdsByProjectId: Record<string, ReadonlyArray<string>> = {};
  for (const [key, spaceIds] of Object.entries(state.customSpaceIdsByProjectKey)) {
    if (key.startsWith(prefix) && spaceIds.length > 0) {
      customSpaceIdsByProjectId[key.slice(prefix.length)] = spaceIds;
    }
  }
  return { spaces, customSpaceIdsByProjectId, defaultProfile };
}

/**
 * The membership changes that make the client's view of one environment's
 * custom spaces match the server's, as `[projectKey, spaceId, member]`.
 */
export function membershipChangesToAdopt(
  clientByProjectKey: Readonly<Record<string, ReadonlyArray<string>>>,
  serverByProjectId: Readonly<Record<string, ReadonlyArray<string>>>,
  environmentId: string,
): Array<[string, string, boolean]> {
  const prefix = `${environmentId}:`;
  const changes: Array<[string, string, boolean]> = [];
  const projectIds = new Set([
    ...Object.keys(serverByProjectId),
    ...Object.keys(clientByProjectKey)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  ]);
  for (const projectId of projectIds) {
    const key = `${prefix}${projectId}`;
    const client = new Set(clientByProjectKey[key] ?? []);
    const server = new Set(serverByProjectId[projectId] ?? []);
    for (const spaceId of server) if (!client.has(spaceId)) changes.push([key, spaceId, true]);
    for (const spaceId of client) if (!server.has(spaceId)) changes.push([key, spaceId, false]);
  }
  return changes;
}

export interface ToolStep {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  readonly at: string;
}

const TOOL_ITEM_TYPES = new Set([
  "dynamic_tool",
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
]);
const FINISHED_ITEM_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);

/** A short, single-line view of a tool's input for its step label. */
function toolInputSummary(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  try {
    const json = JSON.stringify(input);
    return json === undefined || json === "{}" ? "" : json;
  } catch {
    return "";
  }
}

/** The fields of a V2 turn item a step label reads. */
export interface ToolTurnItem {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly title: string | null;
  readonly toolName?: string | null;
  readonly input?: unknown;
  readonly at: string;
}

/**
 * One line per tool call, from the thread's tool turn items, labelled with
 * the tool's name (MCP prefixes dropped) and a short view of its input.
 */
export function toolStepsOf(items: ReadonlyArray<ToolTurnItem>): ReadonlyArray<ToolStep> {
  const steps: ToolStep[] = [];
  for (const item of items) {
    if (!TOOL_ITEM_TYPES.has(item.type)) continue;
    const rawName = item.toolName ?? item.title ?? item.type.replaceAll("_", " ");
    const name = rawName.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
    const detail = toolInputSummary(item.input).replace(/\s+/g, " ").trim();
    const label = detail ? `${name} ${detail}` : name;
    steps.push({
      id: item.id,
      label: label.length > 140 ? `${label.slice(0, 139)}…` : label,
      done: FINISHED_ITEM_STATUSES.has(item.status),
      at: item.at,
    });
  }
  return steps;
}

export type BrainstormActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "thinking" }
  | { readonly kind: "needs-input"; readonly what: "approval" | "answer" }
  | { readonly kind: "error"; readonly message: string };

/**
 * What the chat is doing, for the popup to say out loud: a turn in flight
 * (including the gap between sending and the provider picking it up), a
 * prompt waiting on the user, or a failure.
 */
export function brainstormActivity(input: {
  /** The thread's latest run status ("idle" before the first run). */
  readonly runStatus: string | null;
  readonly lastError: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  /** When the popup sent a message it has not seen answered yet. */
  readonly awaitingSince: string | null;
  /** Newest assistant message that is complete. */
  readonly lastAnswerAt: string | null;
}): BrainstormActivity {
  if (input.hasPendingApprovals) return { kind: "needs-input", what: "approval" };
  if (input.hasPendingUserInput) return { kind: "needs-input", what: "answer" };
  if (
    input.runStatus === "preparing" ||
    input.runStatus === "queued" ||
    input.runStatus === "starting" ||
    input.runStatus === "running" ||
    input.runStatus === "waiting"
  ) {
    return { kind: "thinking" };
  }
  if (input.runStatus === "failed") {
    return { kind: "error", message: input.lastError ?? "The last turn failed." };
  }
  if (
    input.awaitingSince !== null &&
    (input.lastAnswerAt === null || input.lastAnswerAt < input.awaitingSince)
  ) {
    return { kind: "thinking" };
  }
  return { kind: "idle" };
}

/** The two models the brainstorm chat switches between; it is meant to be quick. */
export const BRAINSTORM_MODELS = {
  sonnet: { model: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  opus: { model: "claude-opus-5-5", label: "Opus 5.5" },
} as const;

export type BrainstormModelChoice = keyof typeof BRAINSTORM_MODELS;

export const DEFAULT_BRAINSTORM_MODEL: BrainstormModelChoice = "sonnet";

export function isBrainstormModelChoice(value: unknown): value is BrainstormModelChoice {
  return value === "sonnet" || value === "opus";
}

/** The chat's model choice: what the user toggled, else the default. */
export function brainstormModelChoice(stored: unknown): BrainstormModelChoice {
  return isBrainstormModelChoice(stored) ? stored : DEFAULT_BRAINSTORM_MODEL;
}

export function otherBrainstormModel(choice: BrainstormModelChoice): BrainstormModelChoice {
  return choice === "sonnet" ? "opus" : "sonnet";
}

/** Whether the thread's provider instance offers both brainstorm models. */
export function brainstormModelsOffered(
  models: ReadonlyArray<{ readonly slug: string }> | undefined,
): boolean {
  if (!models) return false;
  const slugs = new Set(models.map((model) => model.slug));
  return Object.values(BRAINSTORM_MODELS).every((entry) => slugs.has(entry.model));
}

/**
 * The thread's selection with the chosen model, on the same provider
 * instance. Options belong to the previous model, so a switch drops them; an
 * unchanged model keeps its selection as is.
 */
export function brainstormModelSelection(
  current: ModelSelection,
  choice: BrainstormModelChoice,
): ModelSelection {
  const model = BRAINSTORM_MODELS[choice].model;
  return current.model === model ? current : { instanceId: current.instanceId, model };
}

/** Cmd+/ (Ctrl+/ elsewhere) flips the model while the popup is open. */
export function isBrainstormModelShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  isMac: boolean,
): boolean {
  if (event.key !== "/" || event.altKey || event.shiftKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Where a worker thread stands, as the board shows it. */
export type BoardThreadStatus =
  | "needs-approval"
  | "needs-input"
  | "failed"
  | "working"
  | "finished"
  | "settled"
  | "archived"
  | "idle"
  | "gone";

interface BoardThreadInput {
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly archivedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly runtime: { readonly status: string } | null;
  readonly latestRun: { readonly status: string } | null;
}

const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running"]);

/** What needs the user comes first, then activity, then how the last run ended. */
export function boardThreadStatus(thread: BoardThreadInput | undefined): BoardThreadStatus {
  if (!thread) return "gone";
  if (thread.archivedAt !== null) return "archived";
  if (thread.hasPendingApprovals) return "needs-approval";
  if (thread.hasPendingUserInput) return "needs-input";
  if (thread.runtime !== null && ACTIVE_RUN_STATUSES.has(thread.runtime.status)) return "working";
  if (thread.settledOverride === "settled") return "settled";
  const status = thread.runtime?.status ?? thread.latestRun?.status;
  if (status === "failed") return "failed";
  if (status === "completed") return "finished";
  return "idle";
}

/** The board's "Needs you" strip: threads waiting on an approval or an answer, or that failed. */
export function needsYou<T extends BoardThreadInput>(threads: ReadonlyArray<T>): T[] {
  return threads.filter((thread) => {
    const status = boardThreadStatus(thread);
    return status === "needs-approval" || status === "needs-input" || status === "failed";
  });
}

export interface BoardGoal {
  readonly key: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly title: string;
  readonly done: boolean;
  readonly notes: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<BrainstormTask>;
}

/**
 * The board's goals: every list's goals for All, else the filtered space's,
 * each with its tasks (open first). Done goals stay out unless asked for, and
 * each list's Inbox comes after its goals.
 */
export function boardGoals(
  lists: ReadonlyArray<BrainstormTaskList>,
  spaceId: string,
  includeDone = false,
): BoardGoal[] {
  const goals: BoardGoal[] = [];
  const inboxes: BoardGoal[] = [];
  for (const list of lists) {
    if (spaceId !== ALL_SPACE_ID && list.spaceId !== spaceId) continue;
    for (const goal of list.goals) {
      if (goal.done && !includeDone) continue;
      const tasks = list.tasks.filter((task) => task.goal === goal.title);
      const entry: BoardGoal = {
        key: `${list.spaceId}:${goal.number}:${goal.title}`,
        spaceId: list.spaceId,
        spaceName: list.spaceName,
        title: goal.title,
        done: goal.done,
        notes: goal.notes,
        tasks: [...tasks.filter((task) => !task.done), ...tasks.filter((task) => task.done)],
      };
      if (goal.title === INBOX_GOAL) {
        if (tasks.some((task) => !task.done) || includeDone) inboxes.push(entry);
      } else {
        goals.push(entry);
      }
    }
  }
  return [...goals, ...inboxes];
}
