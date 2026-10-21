/**
 * The app's two screens. Grow is the Home overlay and the main view; "normal" is the
 * app with Home closed: a thread's full view, settings and the other pages. Only the
 * deprecated classic threads view puts a switch between them; otherwise thread links
 * open in Grow (see GrowRouting) and the full view is one command away. The manager is a thread pinned at
 * the top of the sidebar (see `managerViewStore`).
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";

import { focusThreadInGrow } from "./growFocus";
import { closeHomeOverlay, openHomeOverlay, useHomeOverlayStore } from "./homeOverlayStore";

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

export function setAppMode(mode: AppMode) {
  if (mode === "normal") closeHomeOverlay();
  else openHomeOverlay();
}

/**
 * Back to Grow from a page outside it. From a thread's full view, Grow shows that thread,
 * so leaving the diff or the terminal never loses the place.
 */
export function backToGrow(thread: ScopedThreadRef | null) {
  if (thread !== null && !useHomeOverlayStore.getState().open) {
    focusThreadInGrow(scopedThreadKey(thread));
  }
  openHomeOverlay();
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
