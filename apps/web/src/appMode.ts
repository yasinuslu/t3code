/**
 * The app's three modes, one switch. Grow and Classic are the two views of the
 * Home overlay; Normal is the app with Home closed: the thread list and chat,
 * which stay mounted underneath Home and so keep their place.
 */
import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";

import { closeHomeOverlay, openHomeOverlay, useHomeOverlayStore } from "./homeOverlayStore";

export type AppMode = "grow" | "classic" | "normal";
export type HomeView = "grow" | "classic";

export const APP_MODES: ReadonlyArray<{
  readonly mode: AppMode;
  readonly label: string;
  readonly command: "mode.grow" | "mode.classic" | "mode.normal";
}> = [
  { mode: "grow", label: "Grow", command: "mode.grow" },
  { mode: "classic", label: "Manager", command: "mode.classic" },
  { mode: "normal", label: "T3", command: "mode.normal" },
];

// v2: Grow is the default view; the old stored "list" and "board" values are ignored.
const HOME_VIEW_KEY = "t3code:home-view:v2";

const readView = (): HomeView => {
  try {
    const stored = window.localStorage.getItem(HOME_VIEW_KEY);
    return stored === JSON.stringify("classic") ? "classic" : "grow";
  } catch {
    return "grow";
  }
};

const useHomeViewStore = create<{ readonly view: HomeView }>()(() => ({ view: readView() }));

useHomeViewStore.subscribe((state) => {
  try {
    window.localStorage.setItem(HOME_VIEW_KEY, JSON.stringify(state.view));
  } catch {
    // Storage can be unavailable; the view then resets to Grow on restart.
  }
});

/** Which view Home shows; written only by `setAppMode`. */
export const useHomeView = () => useHomeViewStore((state) => state.view);

export const readAppMode = (): AppMode =>
  !useHomeOverlayStore.getState().open ? "normal" : useHomeViewStore.getState().view;

export const useAppMode = (): AppMode => {
  const open = useHomeOverlayStore((state) => state.open);
  const view = useHomeView();
  return open ? view : "normal";
};

export function setAppMode(mode: AppMode) {
  if (mode === "normal") {
    closeHomeOverlay();
    return;
  }
  useHomeViewStore.setState({ view: mode });
  openHomeOverlay();
}

export function cycleAppMode() {
  const modes = APP_MODES.map((entry) => entry.mode);
  setAppMode(modes[(modes.indexOf(readAppMode()) + 1) % modes.length] ?? "grow");
}

/**
 * Where a scroll container was when its mode was left. Home unmounts on
 * leaving it, so its lists would otherwise come back at the top.
 */
const scrollPositions = new Map<string, number>();

/** A ref callback that restores the element's scroll position and keeps it up to date. */
export function useRememberedScroll(key: string) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback(
    (element: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (element === null) return;
      element.scrollTop = scrollPositions.get(key) ?? 0;
      const onScroll = () => scrollPositions.set(key, element.scrollTop);
      element.addEventListener("scroll", onScroll, { passive: true });
      cleanup.current = () => element.removeEventListener("scroll", onScroll);
    },
    [key],
  );
}
