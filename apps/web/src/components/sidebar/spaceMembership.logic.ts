/**
 * Pure pieces of the Option-key space affordances on thread rows: the badges
 * shown while Option is held, and the entries of the Option-click popover.
 */
import {
  ALL_SPACE_ID,
  isCustomSpace,
  type ProjectSpaces,
  setProjectsInCustomSpace,
  type Space,
  type SpaceState,
} from "../../spaceStore";

/** The spaces a thread's project shows in, home space first; All is skipped. */
export function threadSpaceBadges(
  spaces: ReadonlyArray<Space>,
  projectSpaces: ProjectSpaces,
): ReadonlyArray<Space> {
  const home = spaces.find((space) => space.id === projectSpaces.homeSpaceId);
  const custom = spaces.filter((space) => projectSpaces.customSpaceIds.includes(space.id));
  return [...(home && home.id !== ALL_SPACE_ID ? [home] : []), ...custom];
}

export interface SpaceToggleEntry {
  readonly space: Space;
  readonly checked: boolean;
  /** The home space (profile or Other): shown for context, never toggled. */
  readonly fixed: boolean;
}

/** The home space as a fixed, checked entry, then every custom space as a toggle. */
export function spaceToggleEntries(
  spaces: ReadonlyArray<Space>,
  projectSpaces: ProjectSpaces,
): ReadonlyArray<SpaceToggleEntry> {
  const home = spaces.find((space) => space.id === projectSpaces.homeSpaceId);
  return [
    ...(home && home.id !== ALL_SPACE_ID ? [{ space: home, checked: true, fixed: true }] : []),
    ...spaces.filter(isCustomSpace).map((space) => ({
      space,
      checked: projectSpaces.customSpaceIds.includes(space.id),
      fixed: false,
    })),
  ];
}

/**
 * Adds the project (all its member keys) to a custom space, or removes it
 * when it is already there. Anything but a custom space is left alone.
 */
export function toggleProjectInSpace(
  state: SpaceState,
  memberKeys: ReadonlyArray<string>,
  spaceId: string,
): SpaceState {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (!space || !isCustomSpace(space) || memberKeys.length === 0) return state;
  const isMember = memberKeys.some((key) =>
    (state.customSpaceIdsByProjectKey[key] ?? []).includes(spaceId),
  );
  return setProjectsInCustomSpace(state, memberKeys, spaceId, !isMember);
}
