/**
 * Brainstorm state the lists need: which threads are brainstorm chats (kept
 * out of the normal thread lists), which threads are managers (one per code
 * profile; ordinary threads with a marker), and whose manager Home shows.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveManagerProfile } from "./components/brainstorm/brainstorm.logic";
import { resolveStorage } from "./lib/storage";
import { isInSpace, useProjectSpaceResolver, useSpaceStore } from "./spaceStore";
import { useThreadShells } from "./state/entities";

interface BrainstormStore {
  /** `${environmentId}:${threadId}` of every brainstorm chat except the managers. */
  readonly hiddenThreadKeys: ReadonlySet<string>;
  /**
   * `${environmentId}:${threadId}` of each manager the server has, by profile
   * (`SINGLE_MANAGER_KEY` for the one manager when no profile has a brain).
   */
  readonly managerThreadKeyByProfile: Readonly<Record<string, string>>;
  /** Code profiles with a brain on the manager's machine; null until the server says. */
  readonly profiles: ReadonlyArray<string> | null;
  /** The server's default profile, the manager to show before the user picks one. */
  readonly serverDefaultProfile: string | null;
  /** The profile whose manager the user picked last; kept across sessions. */
  readonly lastManagerProfile: string | null;
  /** Profile whose brain custom spaces, Other and All use; null: the server picks. */
  readonly defaultProfile: string | null;
  readonly setHiddenThreadKeys: (keys: ReadonlySet<string>) => void;
  readonly setManagers: (input: {
    readonly managerThreadKeyByProfile: Readonly<Record<string, string>>;
    readonly profiles: ReadonlyArray<string>;
    readonly serverDefaultProfile: string | null;
  }) => void;
  readonly setManagerThreadKey: (profileKey: string, key: string) => void;
  readonly setLastManagerProfile: (profile: string) => void;
  readonly setDefaultProfile: (profile: string | null) => void;
}

const sameRecord = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => right[key] === value);

export const useBrainstormStore = create<BrainstormStore>()(
  persist(
    (set) => ({
      hiddenThreadKeys: new Set(),
      managerThreadKeyByProfile: {},
      profiles: null,
      serverDefaultProfile: null,
      lastManagerProfile: null,
      defaultProfile: null,
      setHiddenThreadKeys: (keys) =>
        set((state) =>
          state.hiddenThreadKeys.size === keys.size &&
          [...keys].every((key) => state.hiddenThreadKeys.has(key))
            ? state
            : { hiddenThreadKeys: keys },
        ),
      setManagers: (input) =>
        set((state) =>
          sameRecord(state.managerThreadKeyByProfile, input.managerThreadKeyByProfile) &&
          state.profiles?.join("\n") === input.profiles.join("\n") &&
          state.serverDefaultProfile === input.serverDefaultProfile
            ? state
            : input,
        ),
      setManagerThreadKey: (profileKey, key) =>
        set((state) => ({
          managerThreadKeyByProfile: { ...state.managerThreadKeyByProfile, [profileKey]: key },
        })),
      setLastManagerProfile: (lastManagerProfile) =>
        set((state) =>
          state.lastManagerProfile === lastManagerProfile ? state : { lastManagerProfile },
        ),
      setDefaultProfile: (defaultProfile) => set({ defaultProfile }),
    }),
    {
      name: "t3code:brainstorm:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        defaultProfile: state.defaultProfile,
        lastManagerProfile: state.lastManagerProfile,
      }),
      merge: (persisted, current) => {
        const saved = persisted as {
          defaultProfile?: unknown;
          lastManagerProfile?: unknown;
        } | null;
        const text = (value: unknown) => (typeof value === "string" ? value : null);
        return {
          ...current,
          defaultProfile: text(saved?.defaultProfile),
          lastManagerProfile: text(saved?.lastManagerProfile),
        };
      },
    },
  ),
);

/** Every manager thread's `${environmentId}:${threadId}`. */
export function useManagerThreadKeys(): ReadonlySet<string> {
  const byProfile = useBrainstormStore((state) => state.managerThreadKeyByProfile);
  return useMemo(() => new Set(Object.values(byProfile)), [byProfile]);
}

export function useIsManagerThread(environmentId: string, threadId: string): boolean {
  return useBrainstormStore((state) =>
    Object.values(state.managerThreadKeyByProfile).includes(`${environmentId}:${threadId}`),
  );
}

/** The active space's code profile, if it is a profile space. */
export function useActiveSpaceProfile(): string | null {
  return useSpaceStore(
    (store) => store.spaces.find((space) => space.id === store.activeSpaceId)?.profile ?? null,
  );
}

/** Whose manager Home shows; see `resolveManagerProfile`. */
export function useManagerProfile(): string | null {
  const activeSpaceProfile = useActiveSpaceProfile();
  const profiles = useBrainstormStore((state) => state.profiles);
  const lastManagerProfile = useBrainstormStore((state) => state.lastManagerProfile);
  const serverDefaultProfile = useBrainstormStore((state) => state.serverDefaultProfile);
  return resolveManagerProfile({
    profiles: profiles ?? [],
    activeSpaceProfile,
    lastManagerProfile,
    serverDefaultProfile,
  });
}

/** Every thread shell except brainstorm chats, for the normal thread lists. */
export function useThreadShellsWithoutBrainstorms(): ReadonlyArray<EnvironmentThreadShell> {
  const threads = useThreadShells();
  const hidden = useBrainstormStore((state) => state.hiddenThreadKeys);
  return useMemo(
    () =>
      hidden.size === 0
        ? threads
        : threads.filter((thread) => !hidden.has(`${thread.environmentId}:${thread.id}`)),
    [hidden, threads],
  );
}

/**
 * The sidebar's threads: no brainstorm chats and no managers, which the
 * sidebar's Home entry opens instead.
 */
export function useSidebarThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const threads = useThreadShellsWithoutBrainstorms();
  const managerKeys = useManagerThreadKeys();
  return useMemo(
    () =>
      managerKeys.size === 0
        ? threads
        : threads.filter((thread) => !managerKeys.has(`${thread.environmentId}:${thread.id}`)),
    [managerKeys, threads],
  );
}

/** The work Home shows: the sidebar's threads in the active space. */
export function useHomeThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const threads = useSidebarThreadShells();
  const activeSpaceId = useSpaceStore((store) => store.activeSpaceId);
  const resolveSpaces = useProjectSpaceResolver();
  return useMemo(
    () =>
      threads.filter((thread) =>
        isInSpace(resolveSpaces([`${thread.environmentId}:${thread.projectId}`]), activeSpaceId),
      ),
    [activeSpaceId, resolveSpaces, threads],
  );
}
