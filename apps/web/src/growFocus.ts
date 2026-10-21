/**
 * Grow as the app's one main view: thread links land here as a request for Grow to
 * show that thread, and Grow publishes which thread it is showing so the full view
 * (and the commands that act on "this thread") know which one that is.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface GrowFocusStore {
  /** A thread Grow should bring up, as `environmentId:threadId`; Grow clears it once shown. */
  readonly target: string | null;
  /** Grow should bring up the manager's pane (the manager shortcut from outside Grow). */
  readonly manager: boolean;
  /** The page load's own route has been read; until then Grow must not move the route. */
  readonly landed: boolean;
}

export const useGrowFocusStore = create<GrowFocusStore>()(() => ({
  target: null,
  manager: false,
  landed: false,
}));

export const focusThreadInGrow = (key: string) =>
  useGrowFocusStore.setState({ target: key, manager: false });

export const focusManagerInGrow = () => useGrowFocusStore.setState({ target: null, manager: true });

let onScreen: (() => ScopedThreadRef | null) | null = null;

/** Grow registers how to read the thread it shows; returns the unregister. */
export function setGrowOnScreen(read: () => ScopedThreadRef | null): () => void {
  onScreen = read;
  return () => {
    if (onScreen === read) onScreen = null;
  };
}

/** The thread Grow shows now (its item, a thread opened in place, or the manager), if any. */
export const growOnScreenThread = (): ScopedThreadRef | null => onScreen?.() ?? null;

let fullViewOpener: ((thread: ScopedThreadRef) => void) | null = null;

/** The app shell registers how to open a thread's full view; returns the unregister. */
export function setFullViewOpener(open: (thread: ScopedThreadRef) => void): () => void {
  fullViewOpener = open;
  return () => {
    if (fullViewOpener === open) fullViewOpener = null;
  };
}

/**
 * Leaves Grow for a thread's full view: the thread page with its diff, terminal, files and
 * preview panels. Without a thread, the one Grow shows. Returns whether there was one.
 */
export function openFullView(thread: ScopedThreadRef | null = growOnScreenThread()): boolean {
  if (thread === null || fullViewOpener === null) return false;
  fullViewOpener(thread);
  return true;
}
