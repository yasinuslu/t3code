import type {
  BrainstormSpace,
  BrainstormSyncSpacesInput,
  BrainstormTask,
  BrainstormTaskList,
  EnvironmentId,
  ServerConfig,
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

/**
 * The environment that runs the manager: the primary one when it hosts the
 * manager (or nothing does), else the first connected one that does. Lets a
 * laptop open the manager on an always-on machine.
 */
export function resolveManagerEnvironmentId(
  primaryEnvironmentId: EnvironmentId | null,
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
): EnvironmentId | null {
  if (
    primaryEnvironmentId !== null &&
    serverConfigs.get(primaryEnvironmentId)?.settings.hostsManager
  )
    return primaryEnvironmentId;
  for (const [environmentId, config] of serverConfigs) {
    if (config.settings.hostsManager) return environmentId;
  }
  return primaryEnvironmentId;
}
