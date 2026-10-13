import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { GROW_MANAGER_KEY } from "./grow.logic";

export type GrowLeftMode = "threads" | "board";
export type GrowThingTab = "play" | "overview";

interface GrowStore {
  /** What the left side shows: the thread rail, or the kanban board. */
  leftMode: GrowLeftMode;
  /** The selected card (`envId:threadId`) or `GROW_MANAGER_KEY`; the chat shows it. */
  selected: string;
  /** The card selected last, for `m` to return to from the manager. */
  previousThread: string | null;
  /** The user's pick; null until they pick, then the thread's default (Play if playable) applies. */
  thingTab: GrowThingTab | null;
  setLeftMode: (mode: GrowLeftMode) => void;
  select: (key: string) => void;
  /** The manager, or from the manager back to the previous thread. */
  toggleManager: () => void;
  setThingTab: (tab: GrowThingTab) => void;
  /** Select a card, show it in the rail and open its prototype. */
  play: (key: string) => void;
}

/** Where the user was on the board, so reopening Home returns to the same place. */
export const useGrowStore = create<GrowStore>()(
  persist(
    (set) => ({
      leftMode: "threads",
      selected: GROW_MANAGER_KEY,
      previousThread: null,
      thingTab: null,
      setLeftMode: (leftMode) => set({ leftMode }),
      select: (key) =>
        set((state) => ({
          selected: key,
          previousThread: key === GROW_MANAGER_KEY ? state.previousThread : key,
        })),
      toggleManager: () =>
        set((state) =>
          state.selected === GROW_MANAGER_KEY
            ? { selected: state.previousThread ?? GROW_MANAGER_KEY }
            : { selected: GROW_MANAGER_KEY, previousThread: state.selected },
        ),
      setThingTab: (thingTab) => set({ thingTab }),
      play: (key) =>
        set({ selected: key, previousThread: key, leftMode: "threads", thingTab: "play" }),
    }),
    {
      // v2: round 2 stored a different shape; that state is ignored.
      name: "t3code:grow-focus:v2",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ leftMode, selected, previousThread, thingTab }) => ({
        leftMode,
        selected,
        previousThread,
        thingTab,
      }),
    },
  ),
);
