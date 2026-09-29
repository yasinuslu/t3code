/**
 * Brainstorm popup state: whether it is open and for which space, and which
 * threads are brainstorm chats (kept out of the normal thread lists).
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  type BrainstormModelChoice,
  isBrainstormModelChoice,
} from "./components/brainstorm/brainstorm.logic";
import { resolveStorage } from "./lib/storage";
import { useThreadShells } from "./state/entities";

interface BrainstormStore {
  readonly open: boolean;
  readonly spaceId: string | null;
  /** `${environmentId}:${threadId}` of every brainstorm chat. */
  readonly hiddenThreadKeys: ReadonlySet<string>;
  /** Profile whose brain custom spaces, Other and All use; null: the server picks. */
  readonly defaultProfile: string | null;
  /** `${environmentId}:${threadId}` → the model toggled in the popup. */
  readonly modelChoiceByThreadKey: Readonly<Record<string, BrainstormModelChoice>>;
  readonly toggle: (spaceId: string) => void;
  readonly close: () => void;
  readonly setHiddenThreadKeys: (keys: ReadonlySet<string>) => void;
  readonly setDefaultProfile: (profile: string | null) => void;
  readonly setModelChoice: (threadKey: string, choice: BrainstormModelChoice) => void;
}

export const useBrainstormStore = create<BrainstormStore>()(
  persist(
    (set) => ({
      open: false,
      spaceId: null,
      hiddenThreadKeys: new Set(),
      defaultProfile: null,
      modelChoiceByThreadKey: {},
      toggle: (spaceId) => set((state) => (state.open ? { open: false } : { open: true, spaceId })),
      close: () => set({ open: false }),
      setHiddenThreadKeys: (keys) =>
        set((state) =>
          state.hiddenThreadKeys.size === keys.size &&
          [...keys].every((key) => state.hiddenThreadKeys.has(key))
            ? state
            : { hiddenThreadKeys: keys },
        ),
      setDefaultProfile: (defaultProfile) => set({ defaultProfile }),
      setModelChoice: (threadKey, choice) =>
        set((state) => ({
          modelChoiceByThreadKey: { ...state.modelChoiceByThreadKey, [threadKey]: choice },
        })),
    }),
    {
      name: "t3code:brainstorm:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        defaultProfile: state.defaultProfile,
        modelChoiceByThreadKey: state.modelChoiceByThreadKey,
      }),
      merge: (persisted, current) => {
        const stored = persisted as {
          defaultProfile?: unknown;
          modelChoiceByThreadKey?: unknown;
        } | null;
        const profile = stored?.defaultProfile;
        const choices =
          stored?.modelChoiceByThreadKey && typeof stored.modelChoiceByThreadKey === "object"
            ? Object.fromEntries(
                Object.entries(stored.modelChoiceByThreadKey).filter(([, choice]) =>
                  isBrainstormModelChoice(choice),
                ),
              )
            : {};
        return {
          ...current,
          defaultProfile: typeof profile === "string" ? profile : null,
          modelChoiceByThreadKey: choices,
        };
      },
    },
  ),
);

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
