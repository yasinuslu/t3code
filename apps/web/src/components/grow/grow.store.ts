import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { GROW_MANAGER_KEY } from "./grow.logic";

export type GrowLeftMode = "threads" | "board";
export type GrowThingTab = "play" | "overview";
/** The panes whose width can be dragged; the chat takes whatever is left. */
export type GrowPane = "rail" | "thing" | "boardChat";

/** Pixel widths: default, smallest, largest. */
export const GROW_PANE_SIZES: Readonly<
  Record<GrowPane, { readonly initial: number; readonly min: number; readonly max: number }>
> = {
  rail: { initial: 320, min: 240, max: 560 },
  thing: { initial: 600, min: 320, max: 1100 },
  boardChat: { initial: 448, min: 320, max: 900 },
};

interface GrowStore {
  /** What the left side shows: the thread rail, or the kanban board. */
  leftMode: GrowLeftMode;
  /** The selected card (`envId:threadId`) or `GROW_MANAGER_KEY`; the chat shows it. */
  selected: string;
  /** The card selected last, for `m` to return to from the manager. */
  previousThread: string | null;
  /** The user's pick; null until they pick, then the thread's default (Play if playable) applies. */
  thingTab: GrowThingTab | null;
  /** Project filter (`envId:projectId`); null: all projects. Filters rail and board. */
  project: string | null;
  /** Dragged pane widths in px. */
  widths: Record<GrowPane, number>;
  setWidth: (pane: GrowPane, width: number) => void;
  resetWidth: (pane: GrowPane) => void;
  setLeftMode: (mode: GrowLeftMode) => void;
  setProject: (project: string | null) => void;
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
      project: null,
      widths: {
        rail: GROW_PANE_SIZES.rail.initial,
        thing: GROW_PANE_SIZES.thing.initial,
        boardChat: GROW_PANE_SIZES.boardChat.initial,
      },
      setWidth: (pane, width) => set((state) => ({ widths: { ...state.widths, [pane]: width } })),
      resetWidth: (pane) =>
        set((state) => ({ widths: { ...state.widths, [pane]: GROW_PANE_SIZES[pane].initial } })),
      setProject: (project) => set({ project }),
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
      partialize: ({ leftMode, selected, previousThread, thingTab, project, widths }) => ({
        widths,
        project,
        leftMode,
        selected,
        previousThread,
        thingTab,
      }),
    },
  ),
);
