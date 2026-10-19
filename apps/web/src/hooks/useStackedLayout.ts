import type { WindowLayout } from "@t3tools/contracts";

import { useClientSettings } from "./useSettings";
import { useMediaQuery } from "./useMediaQuery";

/** Taller than wide, and wider than a phone (phones keep their own layout). */
const PORTRAIT_WINDOW_QUERY = "(orientation: portrait) and (min-width: 768px)";
const NOT_PHONE_QUERY = "(min-width: 768px)";

export function resolveStackedLayout(
  setting: WindowLayout,
  portraitWindow: boolean,
  notPhone: boolean,
): boolean {
  if (setting === "landscape") return false;
  if (setting === "portrait") return notPhone;
  return portraitWindow;
}

/**
 * Whether the thread view stacks the right panel below the chat instead of
 * beside it. Auto follows the window's aspect ratio, so dragging the window
 * onto a portrait monitor switches it live.
 */
export function useStackedLayout(): boolean {
  const setting = useClientSettings((settings) => settings.windowLayout);
  const portraitWindow = useMediaQuery(PORTRAIT_WINDOW_QUERY);
  const notPhone = useMediaQuery(NOT_PHONE_QUERY);
  return resolveStackedLayout(setting, portraitWindow, notPhone);
}

export const WINDOW_LAYOUT_OPTIONS = [
  { value: "auto", label: "Auto", description: "Portrait when the window is taller than wide" },
  { value: "landscape", label: "Normal", description: "Panels side by side" },
  { value: "portrait", label: "Portrait", description: "Panel below the chat" },
] as const satisfies readonly {
  value: WindowLayout;
  label: string;
  description: string;
}[];
