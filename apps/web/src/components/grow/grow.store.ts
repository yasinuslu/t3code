import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type GrowCenterTab = "play" | "overview";
export type GrowDockTab = "thread" | "manager";

interface GrowFocusStore {
  /** The focused card, `envId:threadId`; null shows the whole board. */
  focusedKey: string | null;
  /** The user's pick; null until they pick, then the thread's default (Play if playable) applies. */
  centerTab: GrowCenterTab | null;
  dockTab: GrowDockTab;
  setFocusedKey: (key: string | null) => void;
  setCenterTab: (tab: GrowCenterTab) => void;
  setDockTab: (tab: GrowDockTab) => void;
}

/** Where the user was on the board, so reopening Home returns to the same place. */
export const useGrowFocusStore = create<GrowFocusStore>()(
  persist(
    (set) => ({
      focusedKey: null,
      centerTab: null,
      dockTab: "thread",
      setFocusedKey: (focusedKey) => set({ focusedKey }),
      setCenterTab: (centerTab) => set({ centerTab }),
      setDockTab: (dockTab) => set({ dockTab }),
    }),
    {
      name: "t3code:grow-focus:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ focusedKey, centerTab, dockTab }) => ({ focusedKey, centerTab, dockTab }),
    },
  ),
);
