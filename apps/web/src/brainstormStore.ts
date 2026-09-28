/**
 * Brainstorm popup state: whether it is open and for which space, and which
 * threads are brainstorm chats (kept out of the normal thread lists).
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";
import { create } from "zustand";

import { useThreadShells } from "./state/entities";

interface BrainstormStore {
  readonly open: boolean;
  readonly spaceId: string | null;
  /** `${environmentId}:${threadId}` of every brainstorm chat. */
  readonly hiddenThreadKeys: ReadonlySet<string>;
  readonly toggle: (spaceId: string) => void;
  readonly close: () => void;
  readonly setHiddenThreadKeys: (keys: ReadonlySet<string>) => void;
}

export const useBrainstormStore = create<BrainstormStore>()((set) => ({
  open: false,
  spaceId: null,
  hiddenThreadKeys: new Set(),
  toggle: (spaceId) => set((state) => (state.open ? { open: false } : { open: true, spaceId })),
  close: () => set({ open: false }),
  setHiddenThreadKeys: (keys) =>
    set((state) =>
      state.hiddenThreadKeys.size === keys.size &&
      [...keys].every((key) => state.hiddenThreadKeys.has(key))
        ? state
        : { hiddenThreadKeys: keys },
    ),
}));

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
