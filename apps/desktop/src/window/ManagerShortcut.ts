import type * as Electron from "electron";

import { MENU_ACTION_CHANNEL } from "../ipc/channels.ts";

/** The menu action the renderer turns into "go to the Manager chat". */
export const OPEN_MANAGER_ACTION = "open-manager";

/**
 * The default Manager chord, matched below the page so an iframe or an
 * embedded preview, which swallow keys before the renderer sees them, cannot
 * hide it. `mod+e` on macOS; elsewhere `ctrl+alt+m`, because Ctrl+E is the
 * shell's end-of-line in a terminal. The renderer still handles the configured
 * binding for everything the main window's own page receives.
 */
export const isOpenManagerShortcut = (
  input: Pick<
    Electron.Input,
    "type" | "key" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
  >,
  platform: NodeJS.Platform,
): boolean => {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.shift) return false;
  const key = input.key.toLowerCase();
  if (platform === "darwin") return key === "e" && input.meta && !input.control && !input.alt;
  return key === "m" && input.control && input.alt && !input.meta;
};

/** Brings the main window forward and asks its renderer to open the Manager. */
export const openManagerInWindow = (window: Electron.BrowserWindow): void => {
  if (window.isDestroyed()) return;
  window.webContents.focus();
  window.webContents.send(MENU_ACTION_CHANNEL, OPEN_MANAGER_ACTION);
};
