/**
 * Whether Home is open. Home is an overlay over the whole window: the page
 * underneath stays mounted, so closing it returns to exactly where the user was.
 */
import { createContext, useContext } from "react";
import { create } from "zustand";

interface HomeOverlayStore {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
}

export const useHomeOverlayStore = create<HomeOverlayStore>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

export const openHomeOverlay = () => useHomeOverlayStore.getState().setOpen(true);

let openedOnStartup = false;
let startupHopsUntil = 0;

/** Within seconds of opening on startup, the app is still hopping to its landing page. */
export const inStartupHops = () => Date.now() < startupHopsUntil;

/**
 * Home is the default screen: the start page calls this to open it, once per
 * app load. Later visits to the start page, and closing Home, leave it alone.
 */
export function openHomeOnStartup() {
  if (openedOnStartup) return;
  openedOnStartup = true;
  startupHopsUntil = Date.now() + 8000;
  openHomeOverlay();
}
export const closeHomeOverlay = () => useHomeOverlayStore.getState().setOpen(false);
export const toggleHomeOverlay = () => useHomeOverlayStore.getState().toggle();

/** True inside the Home overlay. */
export const InHomeOverlayContext = createContext(false);

/**
 * Whether this part of the UI sits under the open Home overlay. Window-level
 * handlers of a covered view (thread shortcuts, paste-to-composer) stand down,
 * so keys pressed on Home never reach the thread behind it.
 */
export function useCoveredByHome(): boolean {
  const inOverlay = useContext(InHomeOverlayContext);
  const open = useHomeOverlayStore((state) => state.open);
  return open && !inOverlay;
}
