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

/**
 * Every environment that runs `profile`'s manager, primary first: those that
 * name the profile in `managerProfiles`, else one that hosts every manager
 * (`hostsManager` with no names), else the primary. Each machine that names a
 * profile runs its own manager for it, with its own thread and history. Lets
 * a laptop open the manager on an always-on machine, and each profile's
 * manager live where that profile's work runs. Empty when the managers are
 * split by profile and this one's machine is not connected, so a client never
 * starts a second copy elsewhere.
 */
export function resolveManagerHostIds(
  primaryEnvironmentId: EnvironmentId | null,
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
  profile: string | null = null,
): EnvironmentId[] {
  const ordered = [...serverConfigs].toSorted(
    ([left], [right]) =>
      Number(right === primaryEnvironmentId) - Number(left === primaryEnvironmentId),
  );
  const named = ordered
    .filter(([, config]) => profile !== null && config.settings.managerProfiles.includes(profile))
    .map(([environmentId]) => environmentId);
  if (named.length > 0) return named;
  const all = ordered.find(
    ([, config]) => config.settings.hostsManager && config.settings.managerProfiles.length === 0,
  );
  if (all) return [all[0]];
  const split = ordered.some(([, config]) => config.settings.managerProfiles.length > 0);
  return split || primaryEnvironmentId === null ? [] : [primaryEnvironmentId];
}

/**
 * The environment whose manager Home shows for `profile`: the machine the
 * user picked last when it still hosts that manager, else the first host (see
 * `resolveManagerHostIds`). Null when no connected machine hosts it.
 */
export function resolveManagerEnvironmentId(
  primaryEnvironmentId: EnvironmentId | null,
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
  profile: string | null = null,
  pickedEnvironmentId: string | null = null,
): EnvironmentId | null {
  const hosts = resolveManagerHostIds(primaryEnvironmentId, serverConfigs, profile);
  return hosts.find((environmentId) => environmentId === pickedEnvironmentId) ?? hosts[0] ?? null;
}

/**
 * Whether a machine cannot be reached now: it dropped (a closed laptop shows
 * as reconnecting), failed, or this device is offline. Unknown (no entry)
 * and a first connect attempt still count as reachable.
 */
export function isEnvironmentUnreachable(phase: string | undefined): boolean {
  return phase !== undefined && phase !== "connected" && phase !== "connecting";
}

/** Every connected environment that runs a manager, else the primary one. */
export function resolveManagerEnvironmentIds(
  primaryEnvironmentId: EnvironmentId | null,
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
): EnvironmentId[] {
  const hosts = [...serverConfigs]
    .filter(
      ([, config]) => config.settings.hostsManager || config.settings.managerProfiles.length > 0,
    )
    .map(([environmentId]) => environmentId);
  if (hosts.length > 0) return hosts;
  return primaryEnvironmentId === null ? [] : [primaryEnvironmentId];
}

/** Key of the single manager in the client's map when no profile has a brain. */
export const SINGLE_MANAGER_KEY = "";

/** Where the client keeps one machine's manager for a profile (`null` for the single one). */
export function managerSlot(environmentId: string, profile: string | null): string {
  return `${environmentId}:${profile ?? SINGLE_MANAGER_KEY}`;
}

/**
 * Whose manager Home shows: the active space's profile, else the profile
 * last picked, else the server's default profile. Null when no profile has a
 * brain (one manager for everything).
 */
export function resolveManagerProfile(input: {
  readonly profiles: ReadonlyArray<string>;
  readonly activeSpaceProfile: string | null;
  readonly lastManagerProfile: string | null;
  readonly serverDefaultProfile: string | null;
}): string | null {
  const known = (profile: string | null) =>
    profile !== null && input.profiles.includes(profile) ? profile : null;
  return (
    known(input.activeSpaceProfile) ??
    known(input.lastManagerProfile) ??
    known(input.serverDefaultProfile) ??
    input.profiles[0] ??
    null
  );
}

/** The manager profile switcher's value for All; profile names never contain a colon. */
export const MANAGER_PROFILE_ALL = ":all";

/** The manager profile switcher's segments, in display order. */
export function managerProfileChoices(
  profiles: ReadonlyArray<string>,
  includeAll: boolean,
): ReadonlyArray<string> {
  return includeAll ? [...profiles, MANAGER_PROFILE_ALL] : profiles;
}

/**
 * The segment a thumb button steps to from `current`, wrapping at both ends
 * like the sidebar's space switcher. From nothing selected, forward is the
 * first segment and back the last.
 */
export function adjacentManagerProfileChoice(
  choices: ReadonlyArray<string>,
  current: string | null,
  direction: 1 | -1,
): string | null {
  if (choices.length < 2) return null;
  const index = current === null ? -1 : choices.indexOf(current);
  if (index === -1) return (direction === 1 ? choices[0] : choices.at(-1)) ?? null;
  return choices[(index + direction + choices.length) % choices.length] ?? null;
}
