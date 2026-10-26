import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

import { type ResizableWidthHandlers, useResizableWidth } from "./useResizableWidth";
import { observeResize } from "../lib/observeResize";

export interface PreviewPanelInlineSize {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
}

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
/** Below this, the sibling chat column's composer overflows. */
const SIBLING_COLUMN_MIN_WIDTH = 360;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function usePreviewPanelInlineSize(
  hostRef?: RefObject<HTMLElement | null>,
  options: {
    readonly enabled?: boolean | undefined;
    readonly widthStorageKey?: string | undefined;
    readonly defaultWidth?: number | undefined;
    readonly container?: HTMLElement | null | undefined;
  } = {},
): PreviewPanelInlineSize {
  const maxWidth = useViewportClampedMaxWidth(hostRef, options.enabled ?? true, options.container);
  return useResizableWidth({
    storageKey: options.widthStorageKey ?? PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: options.defaultWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
}

function useViewportClampedMaxWidth(
  hostRef: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
  container: HTMLElement | null | undefined,
): number {
  const [maxWidth, setMaxWidth] = useState(() =>
    getPreviewPanelMaxWidth(typeof window === "undefined" ? 1280 : window.innerWidth),
  );
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const row = container ?? (enabled ? hostRef?.current?.parentElement : null) ?? null;
    // Clamp before paint to avoid flashing; store only the cap, which rarely changes during sidebar drags.
    const measure = () => {
      setMaxWidth(getPreviewPanelMaxWidth(window.innerWidth, row?.clientWidth));
    };
    measure();
    let frame = 0;
    const onResize = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    const stopObserving = row ? observeResize(row, measure) : undefined;
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      stopObserving?.();
    };
  }, [container, hostRef, enabled]);
  return maxWidth;
}
function getPreviewPanelMaxWidth(viewportWidth: number, containerWidth?: number): number {
  const fractionCap = Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
  const containerCap =
    containerWidth === undefined ? Infinity : Math.floor(containerWidth) - SIBLING_COLUMN_MIN_WIDTH;
  // Keep max >= min; an inverted clamp would overwrite the saved width on drag end.
  return Math.max(PREVIEW_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap));
}

const PREVIEW_PANEL_HEIGHT_STORAGE_KEY = "t3code:preview-panel-height";
const PREVIEW_PANEL_MIN_HEIGHT = 240;
/** Room the chat column keeps above a stacked panel: header, a few messages, composer. */
const STACKED_CHAT_MIN_HEIGHT = 320;
const PREVIEW_PANEL_DEFAULT_HEIGHT_FRACTION = 0.45;

/**
 * Height of the right panel when it stacks below the chat (portrait layout).
 * Shares the inline size shape: `width` is the panel's extent along the
 * stacking axis, here its height.
 */
export function usePreviewPanelStackedSize(
  options: { readonly storageKey?: string | undefined } = {},
): PreviewPanelInlineSize {
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 1600 : window.innerHeight));
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const onResize = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setVh(window.innerHeight);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
  return useResizableWidth({
    storageKey: options.storageKey ?? PREVIEW_PANEL_HEIGHT_STORAGE_KEY,
    defaultWidth: Math.round(vh * PREVIEW_PANEL_DEFAULT_HEIGHT_FRACTION),
    minWidth: PREVIEW_PANEL_MIN_HEIGHT,
    maxWidth: Math.max(PREVIEW_PANEL_MIN_HEIGHT, vh - STACKED_CHAT_MIN_HEIGHT),
    edge: "top",
  });
}
