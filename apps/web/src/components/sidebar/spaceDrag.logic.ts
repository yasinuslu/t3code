/**
 * Pure pieces of the Option-key space affordances: the badges a thread row
 * shows while Option is held, and the drop targets of an Option-drag.
 */
import {
  ALL_SPACE_ID,
  isCustomSpace,
  type ProjectSpaces,
  setProjectsInCustomSpace,
  type Space,
  type SpaceState,
} from "../../spaceStore";

/** Pointer travel before an Option-press on a row becomes a space drag. */
export const SPACE_DRAG_THRESHOLD_PX = 4;

/** The spaces a thread's project shows in, home space first; All is skipped. */
export function threadSpaceBadges(
  spaces: ReadonlyArray<Space>,
  projectSpaces: ProjectSpaces,
): ReadonlyArray<Space> {
  const home = spaces.find((space) => space.id === projectSpaces.homeSpaceId);
  const custom = spaces.filter((space) => projectSpaces.customSpaceIds.includes(space.id));
  return [...(home && home.id !== ALL_SPACE_ID ? [home] : []), ...custom];
}

export interface SpaceDropTarget {
  readonly space: Space;
  /** The project is already in this space: the tile shows a check. */
  readonly isMember: boolean;
}

/** Only custom spaces take drops; profile spaces, Other and All follow the path. */
export function spaceDropTargets(
  spaces: ReadonlyArray<Space>,
  projectSpaces: ProjectSpaces,
): ReadonlyArray<SpaceDropTarget> {
  return spaces
    .filter(isCustomSpace)
    .map((space) => ({ space, isMember: projectSpaces.customSpaceIds.includes(space.id) }));
}

export type SpaceDropOutcome = "added" | "already-member" | "rejected";

/** Dropping adds the project (all its member keys) to a custom space; it never removes. */
export function applySpaceDrop(
  state: SpaceState,
  memberKeys: ReadonlyArray<string>,
  spaceId: string,
): { readonly state: SpaceState; readonly outcome: SpaceDropOutcome } {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (!space || !isCustomSpace(space) || memberKeys.length === 0) {
    return { state, outcome: "rejected" };
  }
  const isMember = memberKeys.some((key) =>
    (state.customSpaceIdsByProjectKey[key] ?? []).includes(spaceId),
  );
  if (isMember) return { state, outcome: "already-member" };
  return { state: setProjectsInCustomSpace(state, memberKeys, spaceId, true), outcome: "added" };
}
