/**
 * The app's two screens, one switch. Grow is the Home overlay; Threads ("normal")
 * is the app with Home closed: the thread list and chat, which stay mounted
 * underneath Home and so keep their place. The manager chat is not a screen:
 * it floats over either one (see `managerOverlayStore`).
 */
import { useCallback, useEffect, useRef } from "react";

import { closeHomeOverlay, openHomeOverlay, useHomeOverlayStore } from "./homeOverlayStore";
import { closeManagerOverlay } from "./managerOverlayStore";

export type AppMode = "grow" | "normal";

export const APP_MODES: ReadonlyArray<{
  readonly mode: AppMode;
  readonly label: string;
  readonly command: "mode.grow" | "mode.normal";
}> = [
  { mode: "grow", label: "Grow", command: "mode.grow" },
  { mode: "normal", label: "Threads", command: "mode.normal" },
];

export const readAppMode = (): AppMode => (useHomeOverlayStore.getState().open ? "grow" : "normal");

export const useAppMode = (): AppMode =>
  useHomeOverlayStore((state) => state.open) ? "grow" : "normal";

/** Switching screens puts the manager away, so the chosen screen is what shows. */
export function setAppMode(mode: AppMode) {
  closeManagerOverlay();
  if (mode === "normal") closeHomeOverlay();
  else openHomeOverlay();
}

export function cycleAppMode() {
  setAppMode(readAppMode() === "grow" ? "normal" : "grow");
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
