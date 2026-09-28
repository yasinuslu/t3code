/**
 * Spaces: named, colored groups of projects the sidebar can switch between.
 *
 * There are two kinds. A profile space is seeded from a code profile (see
 * `filesystem.codeProfiles`) and holds exactly the projects whose workspace
 * sits in that profile; membership follows the path and cannot be changed.
 * A custom space (made with "+") is an overlay: the user adds projects to it,
 * and a project can be in any number of custom spaces while it stays in its
 * profile space. "All" shows every project; "Other" holds the projects no
 * profile space claims, and is path-based like a profile space.
 *
 * Each space remembers the last thread or draft it showed and its project
 * filter, so switching back restores it. Right-panel tabs and drafts are
 * already thread-scoped, so restoring the thread restores them too.
 */
import type { ProjectIconColor, ProjectIconOverride } from "@t3tools/contracts";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { deriveProjectIdentity } from "./projectIdentity";
import { PROJECT_ICON_COLORS } from "./projectIconColors";

export const ALL_SPACE_ID = "all";
export const OTHER_SPACE_ID = "other";
const SPACE_STORAGE_KEY = "t3code:spaces:v1";
/** Version 2 replaced single placements with custom-space overlay memberships. */
const SPACE_STORAGE_VERSION = 2;

export interface Space {
  readonly id: string;
  readonly name: string;
  readonly color: ProjectIconColor;
  readonly icon: ProjectIconOverride;
  /** Code profile whose projects make up this space; null for custom and built-in spaces. */
  readonly profile: string | null;
}

export type SpaceRoute =
  | { readonly kind: "server"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "draft"; readonly draftId: string };

export interface SpaceState {
  /** Display order. All is always first and Other always last. */
  readonly spaces: ReadonlyArray<Space>;
  readonly activeSpaceId: string;
  /** Custom spaces each project was added to, by `${environmentId}:${projectId}`. */
  readonly customSpaceIdsByProjectKey: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Last known code profile by `${environmentId}:${projectId}`. */
  readonly detectedProfileByProjectKey: Readonly<Record<string, string | null>>;
  readonly lastRouteBySpaceId: Readonly<Record<string, SpaceRoute>>;
  readonly projectScopeKeyBySpaceId: Readonly<Record<string, string | null>>;
}

/** Where a project group shows up besides All. */
export interface ProjectSpaces {
  /** The profile space its path puts it in, else Other. */
  readonly homeSpaceId: string;
  /** Custom spaces it was added to, in display order. */
  readonly customSpaceIds: ReadonlyArray<string>;
}

const BUILTIN_SPACES: ReadonlyArray<Space> = [
  {
    id: ALL_SPACE_ID,
    name: "All",
    color: "gray",
    icon: { kind: "lucide", name: "layers", color: "gray" },
    profile: null,
  },
  {
    id: OTHER_SPACE_ID,
    name: "Other",
    color: "gray",
    icon: { kind: "lucide", name: "folder", color: "gray" },
    profile: null,
  },
];

export const initialSpaceState: SpaceState = {
  spaces: BUILTIN_SPACES,
  activeSpaceId: ALL_SPACE_ID,
  customSpaceIdsByProjectKey: {},
  detectedProfileByProjectKey: {},
  lastRouteBySpaceId: {},
  projectScopeKeyBySpaceId: {},
};

export function isBuiltinSpace(spaceId: string): boolean {
  return spaceId === ALL_SPACE_ID || spaceId === OTHER_SPACE_ID;
}

/** A space made with "+": the only kind projects can be added to or removed from. */
export function isCustomSpace(space: Pick<Space, "id" | "profile">): boolean {
  return !isBuiltinSpace(space.id) && space.profile === null;
}

/** Profile spaces are re-seeded from the code profiles, so only custom spaces can be deleted. */
export function isDeletableSpace(space: Pick<Space, "id" | "profile">): boolean {
  return isCustomSpace(space);
}

export function spaceColor(space: Pick<Space, "color" | "icon">): ProjectIconColor {
  return space.icon.kind === "emoji" ? space.color : space.icon.color;
}

/** All first, Other last, user spaces in between in their saved order. */
function normalizeSpaces(spaces: ReadonlyArray<Space>): ReadonlyArray<Space> {
  const byId = new Map(spaces.map((space) => [space.id, space] as const));
  const all = byId.get(ALL_SPACE_ID) ?? BUILTIN_SPACES[0]!;
  const other = byId.get(OTHER_SPACE_ID) ?? BUILTIN_SPACES[1]!;
  return [all, ...spaces.filter((space) => !isBuiltinSpace(space.id)), other];
}

type ResolveState = Pick<
  SpaceState,
  "spaces" | "customSpaceIdsByProjectKey" | "detectedProfileByProjectKey"
>;

/**
 * The spaces of a project group (one logical project that can span several
 * checkouts and environments), given its `${environmentId}:${projectId}`
 * member keys. The home space comes from the first member whose code profile
 * has a space: members without a detected profile (an environment that cannot
 * report one, or a folder outside every profile) must not drag the whole group
 * into Other. Custom memberships of any member count for the group.
 */
export function resolveProjectSpaces(
  state: ResolveState,
  memberKeys: ReadonlyArray<string>,
): ProjectSpaces {
  let homeSpaceId = OTHER_SPACE_ID;
  for (const key of memberKeys) {
    const profile = state.detectedProfileByProjectKey[key];
    const profileSpace = profile
      ? state.spaces.find((candidate) => candidate.profile === profile)
      : undefined;
    if (profileSpace) {
      homeSpaceId = profileSpace.id;
      break;
    }
  }
  const memberships = new Set(
    memberKeys.flatMap((key) => state.customSpaceIdsByProjectKey[key] ?? []),
  );
  const customSpaceIds = state.spaces
    .filter((space) => isCustomSpace(space) && memberships.has(space.id))
    .map((space) => space.id);
  return { homeSpaceId, customSpaceIds };
}

/** Whether a project with these spaces shows in `spaceId`; All shows everything. */
export function isInSpace(projectSpaces: ProjectSpaces, spaceId: string): boolean {
  return (
    spaceId === ALL_SPACE_ID ||
    projectSpaces.homeSpaceId === spaceId ||
    projectSpaces.customSpaceIds.includes(spaceId)
  );
}

/**
 * Resolves project groups, given their member keys, to their spaces with the
 * current store state; re-renders only when memberships, detections or the
 * space list change.
 */
export function useProjectSpaceResolver(): (memberKeys: ReadonlyArray<string>) => ProjectSpaces {
  const spaces = useSpaceStore((store) => store.spaces);
  const customSpaceIdsByProjectKey = useSpaceStore((store) => store.customSpaceIdsByProjectKey);
  const detectedProfileByProjectKey = useSpaceStore((store) => store.detectedProfileByProjectKey);
  return useMemo(() => {
    const state = { spaces, customSpaceIdsByProjectKey, detectedProfileByProjectKey };
    return (memberKeys: ReadonlyArray<string>) => resolveProjectSpaces(state, memberKeys);
  }, [customSpaceIdsByProjectKey, detectedProfileByProjectKey, spaces]);
}

/** Keeps only the projects of the active space; All keeps every project. */
export function useActiveSpaceProjects<
  TProject extends { readonly environmentId: string; readonly id: string },
>(projects: ReadonlyArray<TProject>): ReadonlyArray<TProject> {
  const activeSpaceId = useSpaceStore((store) => store.activeSpaceId);
  const resolveSpaces = useProjectSpaceResolver();
  return useMemo(
    () =>
      activeSpaceId === ALL_SPACE_ID
        ? projects
        : projects.filter((project) =>
            isInSpace(resolveSpaces([`${project.environmentId}:${project.id}`]), activeSpaceId),
          ),
    [activeSpaceId, projects, resolveSpaces],
  );
}

function newSpaceId(): string {
  return `space-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function spaceForName(name: string, profile: string | null): Space {
  const identity = deriveProjectIdentity(name);
  return {
    id: newSpaceId(),
    name,
    color: identity.color,
    icon: { kind: "monogram", text: identity.monogram, color: identity.color },
    profile,
  };
}

/** Adds a space for each profile that has none yet. */
export function seedProfileSpaces(state: SpaceState, profiles: ReadonlyArray<string>): SpaceState {
  const added = [...new Set(profiles)]
    .filter((profile) => !state.spaces.some((space) => space.profile === profile))
    .map((profile) => spaceForName(profile, profile));
  if (added.length === 0) return state;
  return { ...state, spaces: normalizeSpaces([...state.spaces, ...added]) };
}

/**
 * Adds projects, by `${environmentId}:${projectId}`, to a custom space or
 * removes them from it. Profile spaces, Other and All are not targets.
 */
export function setProjectsInCustomSpace(
  state: SpaceState,
  projectKeys: ReadonlyArray<string>,
  spaceId: string,
  member: boolean,
): SpaceState {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (!space || !isCustomSpace(space)) return state;
  const next: Record<string, ReadonlyArray<string>> = { ...state.customSpaceIdsByProjectKey };
  for (const key of projectKeys) {
    const current = next[key] ?? [];
    const updated = member
      ? current.includes(spaceId)
        ? current
        : [...current, spaceId]
      : current.filter((id) => id !== spaceId);
    if (updated.length > 0) next[key] = updated;
    else delete next[key];
  }
  return { ...state, customSpaceIdsByProjectKey: next };
}

function withoutMembership(
  memberships: Readonly<Record<string, ReadonlyArray<string>>>,
  spaceId: string,
): Record<string, ReadonlyArray<string>> {
  const next: Record<string, ReadonlyArray<string>> = {};
  for (const [key, spaceIds] of Object.entries(memberships)) {
    const kept = spaceIds.filter((id) => id !== spaceId);
    if (kept.length > 0) next[key] = kept;
  }
  return next;
}

/** Deletes a custom space and its memberships; other spaces are left alone. */
export function removeSpace(state: SpaceState, spaceId: string): SpaceState {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (!space || !isDeletableSpace(space)) return state;
  const without = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== spaceId));
  return {
    ...state,
    spaces: state.spaces.filter((candidate) => candidate.id !== spaceId),
    activeSpaceId: state.activeSpaceId === spaceId ? ALL_SPACE_ID : state.activeSpaceId,
    customSpaceIdsByProjectKey: withoutMembership(state.customSpaceIdsByProjectKey, spaceId),
    lastRouteBySpaceId: without(state.lastRouteBySpaceId),
    projectScopeKeyBySpaceId: without(state.projectScopeKeyBySpaceId),
  };
}

/** The neighbour of the active space in display order, wrapping at both ends. */
export function adjacentSpaceId(
  spaces: ReadonlyArray<Pick<Space, "id">>,
  activeSpaceId: string,
  direction: 1 | -1,
): string | null {
  if (spaces.length < 2) return null;
  const index = Math.max(
    0,
    spaces.findIndex((space) => space.id === activeSpaceId),
  );
  return spaces[(index + direction + spaces.length) % spaces.length]?.id ?? null;
}

const SWIPE_THRESHOLD_PX = 90;
const SWIPE_GESTURE_GAP_MS = 180;

/**
 * Turns trackpad wheel events into at most one space step per gesture. A
 * gesture ends after a short pause in events, so momentum scrolling that
 * follows the step cannot trigger a second one.
 */
export function createSpaceSwipeTracker() {
  let accumulatedX = 0;
  let lastEventAt = Number.NEGATIVE_INFINITY;
  let fired = false;
  return (event: { deltaX: number; deltaY: number; timeStamp: number }): 1 | -1 | null => {
    if (event.timeStamp - lastEventAt > SWIPE_GESTURE_GAP_MS) {
      accumulatedX = 0;
      fired = false;
    }
    lastEventAt = event.timeStamp;
    if (fired || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return null;
    accumulatedX += event.deltaX;
    if (Math.abs(accumulatedX) < SWIPE_THRESHOLD_PX) return null;
    fired = true;
    return accumulatedX > 0 ? 1 : -1;
  };
}

function isColor(value: unknown): value is ProjectIconColor {
  return PROJECT_ICON_COLORS.some((color) => color.value === value);
}

function sanitizeIcon(value: unknown): ProjectIconOverride | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  const icon = value as Record<string, unknown>;
  if (icon.kind === "emoji" && typeof icon.emoji === "string" && icon.emoji.length > 0) {
    return { kind: "emoji", emoji: icon.emoji };
  }
  if (!isColor(icon.color)) return null;
  if (icon.kind === "lucide" && typeof icon.name === "string" && icon.name.length > 0) {
    return { kind: "lucide", name: icon.name, color: icon.color };
  }
  if (icon.kind === "monogram" && typeof icon.text === "string" && icon.text.length > 0) {
    return { kind: "monogram", text: icon.text, color: icon.color } as ProjectIconOverride;
  }
  return null;
}

function sanitizeSpaces(value: unknown): ReadonlyArray<Space> {
  if (!Array.isArray(value)) return BUILTIN_SPACES;
  const spaces: Space[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, color, icon, profile } = entry as Record<string, unknown>;
    const parsedIcon = sanitizeIcon(icon);
    if (typeof id !== "string" || !id || typeof name !== "string" || !name || !parsedIcon) {
      continue;
    }
    if (spaces.some((space) => space.id === id)) continue;
    spaces.push({
      id,
      name,
      color: isColor(color) ? color : "gray",
      icon: parsedIcon,
      profile: typeof profile === "string" && profile ? profile : null,
    });
  }
  return normalizeSpaces(spaces);
}

function sanitizeRecord<T>(value: unknown, accept: (entry: unknown) => entry is T) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, T] => accept(entry[1])),
  );
}

function isSpaceRoute(value: unknown): value is SpaceRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return route.kind === "server"
    ? typeof route.environmentId === "string" && typeof route.threadId === "string"
    : route.kind === "draft" && typeof route.draftId === "string";
}

export function parsePersistedSpaceState(value: unknown): SpaceState {
  if (!value || typeof value !== "object") return initialSpaceState;
  const persisted = value as Record<string, unknown>;
  const spaces = sanitizeSpaces(persisted.spaces);
  const activeSpaceId =
    typeof persisted.activeSpaceId === "string" &&
    spaces.some((space) => space.id === persisted.activeSpaceId)
      ? persisted.activeSpaceId
      : ALL_SPACE_ID;
  const isString = (entry: unknown): entry is string => typeof entry === "string";
  const isStringList = (entry: unknown): entry is ReadonlyArray<string> =>
    Array.isArray(entry) && entry.every(isString);
  return {
    spaces,
    activeSpaceId,
    customSpaceIdsByProjectKey: sanitizeRecord(persisted.customSpaceIdsByProjectKey, isStringList),
    detectedProfileByProjectKey: sanitizeRecord(
      persisted.detectedProfileByProjectKey,
      (entry): entry is string | null => entry === null || typeof entry === "string",
    ),
    lastRouteBySpaceId: sanitizeRecord(persisted.lastRouteBySpaceId, isSpaceRoute),
    projectScopeKeyBySpaceId: sanitizeRecord(
      persisted.projectScopeKeyBySpaceId,
      (entry): entry is string | null => entry === null || typeof entry === "string",
    ),
  };
}

/**
 * Version 1 put each project in exactly one space (`projectSpaceByKey`), and
 * remembered seeded profiles so a deleted profile space stayed deleted.
 * Placements in a custom space become overlay memberships; placements in a
 * profile space or Other are dropped, because those now follow the path.
 */
export function migrateSpaceStateFromV1(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const {
    projectSpaceByKey,
    seededProfiles: _seededProfiles,
    ...rest
  } = value as Record<string, unknown>;
  const spaces = sanitizeSpaces(rest.spaces);
  const customSpaceIdsByProjectKey: Record<string, ReadonlyArray<string>> = {};
  if (projectSpaceByKey && typeof projectSpaceByKey === "object") {
    for (const [key, spaceId] of Object.entries(projectSpaceByKey)) {
      const space = spaces.find((candidate) => candidate.id === spaceId);
      if (space && isCustomSpace(space)) customSpaceIdsByProjectKey[key] = [space.id];
    }
  }
  return { ...rest, customSpaceIdsByProjectKey };
}

interface SpaceStore extends SpaceState {
  setActiveSpace: (spaceId: string) => void;
  createSpace: (name: string) => string;
  updateSpace: (spaceId: string, patch: Partial<Pick<Space, "name" | "color" | "icon">>) => void;
  deleteSpace: (spaceId: string) => void;
  /** Adds projects, by `${environmentId}:${projectId}`, to a custom space or removes them. */
  setProjectsInSpace: (
    projectKeys: ReadonlyArray<string>,
    spaceId: string,
    member: boolean,
  ) => void;
  recordCodeProfiles: (
    profiles: ReadonlyArray<string>,
    detected: Readonly<Record<string, string | null>>,
  ) => void;
  rememberRoute: (spaceId: string, route: SpaceRoute) => void;
  rememberProjectScope: (spaceId: string, projectKey: string | null) => void;
}

export const useSpaceStore = create<SpaceStore>()(
  persist(
    (set) => ({
      ...initialSpaceState,
      setActiveSpace: (spaceId) =>
        set((state) =>
          state.activeSpaceId === spaceId || !state.spaces.some((space) => space.id === spaceId)
            ? state
            : { activeSpaceId: spaceId },
        ),
      createSpace: (name) => {
        const space = spaceForName(name, null);
        set((state) => ({ spaces: normalizeSpaces([...state.spaces, space]) }));
        return space.id;
      },
      updateSpace: (spaceId, patch) =>
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId ? { ...space, ...patch } : space,
          ),
        })),
      deleteSpace: (spaceId) => set((state) => removeSpace(state, spaceId)),
      setProjectsInSpace: (projectKeys, spaceId, member) =>
        set((state) => setProjectsInCustomSpace(state, projectKeys, spaceId, member)),
      recordCodeProfiles: (profiles, detected) =>
        set((state) => {
          const seeded = seedProfileSpaces(state, profiles);
          const changed = Object.entries(detected).some(
            ([key, profile]) => state.detectedProfileByProjectKey[key] !== profile,
          );
          if (!changed) return seeded;
          return {
            ...seeded,
            detectedProfileByProjectKey: { ...state.detectedProfileByProjectKey, ...detected },
          };
        }),
      rememberRoute: (spaceId, route) =>
        set((state) => {
          const current = state.lastRouteBySpaceId[spaceId];
          if (
            current &&
            (current.kind === "server" && route.kind === "server"
              ? current.environmentId === route.environmentId && current.threadId === route.threadId
              : current.kind === "draft" && route.kind === "draft"
                ? current.draftId === route.draftId
                : false)
          ) {
            return state;
          }
          return { lastRouteBySpaceId: { ...state.lastRouteBySpaceId, [spaceId]: route } };
        }),
      rememberProjectScope: (spaceId, projectKey) =>
        set((state) =>
          (state.projectScopeKeyBySpaceId[spaceId] ?? null) === projectKey
            ? state
            : {
                projectScopeKeyBySpaceId: {
                  ...state.projectScopeKeyBySpaceId,
                  [spaceId]: projectKey,
                },
              },
        ),
    }),
    {
      name: SPACE_STORAGE_KEY,
      version: SPACE_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state): SpaceState => ({
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
        customSpaceIdsByProjectKey: state.customSpaceIdsByProjectKey,
        detectedProfileByProjectKey: state.detectedProfileByProjectKey,
        lastRouteBySpaceId: state.lastRouteBySpaceId,
        projectScopeKeyBySpaceId: state.projectScopeKeyBySpaceId,
      }),
      migrate: (persisted, version) =>
        (version < 2 ? migrateSpaceStateFromV1(persisted) : persisted) as SpaceStore,
      merge: (persisted, current) => ({ ...current, ...parsePersistedSpaceState(persisted) }),
    },
  ),
);
