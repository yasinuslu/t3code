/**
 * Spaces: named, colored groups of projects the sidebar can switch between.
 *
 * Every project belongs to exactly one user space. "All" is a view over every
 * project and never owns one; "Other" holds projects no other space claims.
 * A project the user never moved lands in the space seeded from the code
 * profile its workspace sits in (see `filesystem.codeProfiles`), else Other.
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

export interface Space {
  readonly id: string;
  readonly name: string;
  readonly color: ProjectIconColor;
  readonly icon: ProjectIconOverride;
  /** Code profile whose projects default to this space. */
  readonly profile: string | null;
}

export type SpaceRoute =
  | { readonly kind: "server"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "draft"; readonly draftId: string };

export interface SpaceState {
  /** Display order. All is always first and Other always last. */
  readonly spaces: ReadonlyArray<Space>;
  readonly activeSpaceId: string;
  /** Profiles that already produced a space, so deleting one does not bring it back. */
  readonly seededProfiles: ReadonlyArray<string>;
  /** Explicit placements by `${environmentId}:${projectId}`. */
  readonly projectSpaceByKey: Readonly<Record<string, string>>;
  /** Last known code profile by `${environmentId}:${projectId}`. */
  readonly detectedProfileByProjectKey: Readonly<Record<string, string | null>>;
  readonly lastRouteBySpaceId: Readonly<Record<string, SpaceRoute>>;
  readonly projectScopeKeyBySpaceId: Readonly<Record<string, string | null>>;
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
  seededProfiles: [],
  projectSpaceByKey: {},
  detectedProfileByProjectKey: {},
  lastRouteBySpaceId: {},
  projectScopeKeyBySpaceId: {},
};

export function isBuiltinSpace(spaceId: string): boolean {
  return spaceId === ALL_SPACE_ID || spaceId === OTHER_SPACE_ID;
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

/**
 * The space a project lives in, by `${environmentId}:${projectId}`: the
 * user's placement if its space still exists, else the space seeded from the
 * project's code profile, else Other.
 */
export function resolveProjectSpaceId(
  state: Pick<SpaceState, "spaces" | "projectSpaceByKey" | "detectedProfileByProjectKey">,
  projectKey: string,
): string {
  const explicit = state.projectSpaceByKey[projectKey];
  if (
    explicit !== undefined &&
    explicit !== ALL_SPACE_ID &&
    state.spaces.some((space) => space.id === explicit)
  ) {
    return explicit;
  }
  const profile = state.detectedProfileByProjectKey[projectKey];
  const profileSpace = profile
    ? state.spaces.find((candidate) => candidate.profile === profile)
    : undefined;
  return profileSpace?.id ?? OTHER_SPACE_ID;
}

/**
 * The space of a project group (one logical project that can span several
 * checkouts and environments). A member the user placed wins, then a member
 * whose code profile has a space. Members without a detected profile (an
 * environment that cannot report one, or a folder outside every profile)
 * must not drag the whole group into Other.
 */
export function resolveProjectGroupSpaceId(
  state: Pick<SpaceState, "spaces" | "projectSpaceByKey" | "detectedProfileByProjectKey">,
  memberKeys: ReadonlyArray<string>,
): string {
  const placed = memberKeys
    .map((key) => state.projectSpaceByKey[key])
    .find(
      (spaceId) =>
        spaceId !== undefined &&
        spaceId !== ALL_SPACE_ID &&
        state.spaces.some((space) => space.id === spaceId),
    );
  if (placed !== undefined) return placed;
  for (const key of memberKeys) {
    const spaceId = resolveProjectSpaceId(state, key);
    if (spaceId !== OTHER_SPACE_ID) return spaceId;
  }
  return OTHER_SPACE_ID;
}

/**
 * Resolves project groups, given their member keys, to spaces with the current
 * store state; re-renders only when placements, detections or the space list change.
 */
export function useProjectSpaceResolver(): (memberKeys: ReadonlyArray<string>) => string {
  const spaces = useSpaceStore((store) => store.spaces);
  const projectSpaceByKey = useSpaceStore((store) => store.projectSpaceByKey);
  const detectedProfileByProjectKey = useSpaceStore((store) => store.detectedProfileByProjectKey);
  return useMemo(() => {
    const state = { spaces, projectSpaceByKey, detectedProfileByProjectKey };
    return (memberKeys: ReadonlyArray<string>) => resolveProjectGroupSpaceId(state, memberKeys);
  }, [detectedProfileByProjectKey, projectSpaceByKey, spaces]);
}

/** Keeps only the projects of the active space; All keeps every project. */
export function useActiveSpaceProjects<
  TProject extends { readonly environmentId: string; readonly id: string },
>(projects: ReadonlyArray<TProject>): ReadonlyArray<TProject> {
  const activeSpaceId = useSpaceStore((store) => store.activeSpaceId);
  const resolveSpace = useProjectSpaceResolver();
  return useMemo(
    () =>
      activeSpaceId === ALL_SPACE_ID
        ? projects
        : projects.filter(
            (project) => resolveSpace([`${project.environmentId}:${project.id}`]) === activeSpaceId,
          ),
    [activeSpaceId, projects, resolveSpace],
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

/** Adds a space for each profile seen for the first time. */
export function seedProfileSpaces(state: SpaceState, profiles: ReadonlyArray<string>): SpaceState {
  const unseen = profiles.filter((profile) => !state.seededProfiles.includes(profile));
  if (unseen.length === 0) return state;
  const added = unseen
    .filter((profile) => !state.spaces.some((space) => space.profile === profile))
    .map((profile) => spaceForName(profile, profile));
  return {
    ...state,
    spaces: normalizeSpaces([...state.spaces, ...added]),
    seededProfiles: [...state.seededProfiles, ...unseen],
  };
}

export function removeSpace(state: SpaceState, spaceId: string): SpaceState {
  if (isBuiltinSpace(spaceId) || !state.spaces.some((space) => space.id === spaceId)) {
    return state;
  }
  const without = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== spaceId));
  return {
    ...state,
    spaces: state.spaces.filter((space) => space.id !== spaceId),
    activeSpaceId: state.activeSpaceId === spaceId ? ALL_SPACE_ID : state.activeSpaceId,
    // Its projects fall back to their default space.
    projectSpaceByKey: Object.fromEntries(
      Object.entries(state.projectSpaceByKey).filter(([, value]) => value !== spaceId),
    ),
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
  return {
    spaces,
    activeSpaceId,
    seededProfiles: Array.isArray(persisted.seededProfiles)
      ? persisted.seededProfiles.filter(isString)
      : [],
    projectSpaceByKey: sanitizeRecord(persisted.projectSpaceByKey, isString),
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

interface SpaceStore extends SpaceState {
  setActiveSpace: (spaceId: string) => void;
  createSpace: (name: string) => string;
  updateSpace: (spaceId: string, patch: Partial<Pick<Space, "name" | "color" | "icon">>) => void;
  deleteSpace: (spaceId: string) => void;
  /** Places projects, by `${environmentId}:${projectId}`, in a space. */
  assignProjects: (projectKeys: ReadonlyArray<string>, spaceId: string) => void;
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
      assignProjects: (projectKeys, spaceId) =>
        set((state) =>
          spaceId === ALL_SPACE_ID
            ? state
            : {
                projectSpaceByKey: {
                  ...state.projectSpaceByKey,
                  ...Object.fromEntries(projectKeys.map((key) => [key, spaceId] as const)),
                },
              },
        ),
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
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state): SpaceState => ({
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
        seededProfiles: state.seededProfiles,
        projectSpaceByKey: state.projectSpaceByKey,
        detectedProfileByProjectKey: state.detectedProfileByProjectKey,
        lastRouteBySpaceId: state.lastRouteBySpaceId,
        projectScopeKeyBySpaceId: state.projectScopeKeyBySpaceId,
      }),
      merge: (persisted, current) => ({ ...current, ...parsePersistedSpaceState(persisted) }),
    },
  ),
);
