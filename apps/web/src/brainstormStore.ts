/**
 * Brainstorm state the lists need: which threads are brainstorm chats (kept
 * out of the normal thread lists), which thread is the manager (an ordinary,
 * listed thread with a marker) and the manager's brain choice.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { useThreadShells } from "./state/entities";

interface BrainstormStore {
  /** `${environmentId}:${threadId}` of every brainstorm chat except the manager. */
  readonly hiddenThreadKeys: ReadonlySet<string>;
  /** `${environmentId}:${threadId}` of the manager thread, once the server has one. */
  readonly managerThreadKey: string | null;
  /** Profile whose brain custom spaces, Other and All use; null: the server picks. */
  readonly defaultProfile: string | null;
  readonly setHiddenThreadKeys: (keys: ReadonlySet<string>) => void;
  readonly setManagerThreadKey: (key: string | null) => void;
  readonly setDefaultProfile: (profile: string | null) => void;
}

export const useBrainstormStore = create<BrainstormStore>()(
  persist(
    (set) => ({
      hiddenThreadKeys: new Set(),
      managerThreadKey: null,
      defaultProfile: null,
      setHiddenThreadKeys: (keys) =>
        set((state) =>
          state.hiddenThreadKeys.size === keys.size &&
          [...keys].every((key) => state.hiddenThreadKeys.has(key))
            ? state
            : { hiddenThreadKeys: keys },
        ),
      setManagerThreadKey: (managerThreadKey) => set({ managerThreadKey }),
      setDefaultProfile: (defaultProfile) => set({ defaultProfile }),
    }),
    {
      name: "t3code:brainstorm:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ defaultProfile: state.defaultProfile }),
      merge: (persisted, current) => {
        const profile = (persisted as { defaultProfile?: unknown } | null)?.defaultProfile;
        return { ...current, defaultProfile: typeof profile === "string" ? profile : null };
      },
    },
  ),
);

export function useIsManagerThread(environmentId: string, threadId: string): boolean {
  return useBrainstormStore((state) => state.managerThreadKey === `${environmentId}:${threadId}`);
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
