import * as Electron from "electron";

import { MENU_ACTION_CHANNEL } from "../ipc/channels.ts";

/** The menu actions the renderer turns into "show or hide the manager" and "show the manager". */
export const TOGGLE_MANAGER_ACTION = "toggle-manager";
export const OPEN_MANAGER_ACTION = "open-manager";

/** The manager chord as the renderer resolved it from `manager.toggle`, `mod` already applied. */
export interface ManagerChord {
  /** A shortcut key as in keybindings.json: a lower-case letter, a digit, " ", "f1", ... */
  readonly key: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  escape: "Escape",
  enter: "Return",
  tab: "Tab",
  backspace: "Backspace",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
};

/** The Electron accelerator for a chord, or null for a key a global shortcut cannot take. */
export function managerChordAccelerator(
  chord: ManagerChord,
  platform: NodeJS.Platform,
): string | null {
  const key = chord.key.toLowerCase();
  const name =
    NAMED_KEYS[key] ??
    (/^[a-z0-9]$/.test(key) ? key.toUpperCase() : null) ??
    (/^f([1-9]|1[0-9]|2[0-4])$/.test(key) ? key.toUpperCase() : null) ??
    (/^[`\-=[\];',./\\]$/.test(key) ? key : null);
  // A global chord with no modifier would take a plain key away from every app.
  if (name === null || !(chord.control || chord.alt || chord.meta)) return null;
  const modifiers = [
    chord.control ? "Control" : null,
    chord.alt ? "Alt" : null,
    chord.meta ? (platform === "darwin" ? "Command" : "Super") : null,
    chord.shift ? "Shift" : null,
  ].filter((modifier) => modifier !== null);
  return [...modifiers, name].join("+");
}

/** The physical key of an input, so Option-modified letters on macOS still match. */
function inputKey(input: Pick<Electron.Input, "key" | "code">): string {
  const letter = input.code.match(/^Key([A-Z])$/)?.[1];
  if (letter) return letter.toLowerCase();
  const digit = input.code.match(/^Digit([0-9])$/)?.[1];
  if (digit) return digit;
  if (input.code === "Space") return " ";
  return input.key.toLowerCase();
}

/**
 * Whether a key press below the page is the manager chord, so an iframe or an
 * embedded preview, which swallow keys before the renderer sees them, cannot
 * hide it. Only needed where the system-wide registration failed (Wayland).
 */
export const isManagerShortcut = (
  input: Pick<
    Electron.Input,
    "type" | "key" | "code" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
  >,
  chord: ManagerChord | null,
): boolean =>
  chord !== null &&
  input.type === "keyDown" &&
  !input.isAutoRepeat &&
  input.control === chord.control &&
  input.alt === chord.alt &&
  input.meta === chord.meta &&
  input.shift === chord.shift &&
  inputKey(input) === chord.key;

// Grow's keys (apps/web/src/components/grow/grow.keys.ts, GROW_KEY_CODES). Held with Alt they
// work from anywhere, so they are taken from a preview page that has focus.
const GROW_KEY_CODES = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyX",
  "KeyZ",
  "KeyR",
  "KeyF",
  "KeyG",
  "KeyT",
  "KeyV",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
]);

/**
 * The menu action for a Grow key held with Alt below the page (`grow-key:<code>:<shift>`),
 * or null for any other press. The renderer replays it as the same key press.
 */
export function growKeyAction(
  input: Pick<
    Electron.Input,
    "type" | "code" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
  >,
): string | null {
  if (input.type !== "keyDown" || !input.alt || input.control || input.meta) return null;
  if (input.isAutoRepeat || !GROW_KEY_CODES.has(input.code)) return null;
  return `grow-key:${input.code}:${input.shift ? 1 : 0}`;
}

/** The Grow keys that take focus out of the page (to a place, search, the manager). */
export const growKeyLeavesPage = (code: string): boolean =>
  code === "Digit1" ||
  code === "Digit2" ||
  code === "Digit4" ||
  code === "KeyQ" ||
  code === "KeyF" ||
  code === "KeyT";

/** Asks a window's renderer to show or hide the manager, bringing the window forward first. */
export const sendManagerAction = (
  window: Electron.BrowserWindow,
  action: typeof TOGGLE_MANAGER_ACTION | typeof OPEN_MANAGER_ACTION,
): void => {
  if (window.isDestroyed()) return;
  if (action === OPEN_MANAGER_ACTION) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  window.webContents.focus();
  window.webContents.send(MENU_ACTION_CHANNEL, action);
};

let current: {
  readonly chord: ManagerChord;
  readonly window: Electron.BrowserWindow;
  readonly accelerator: string | null;
} | null = null;

/** The chord the main window's renderer reported, for the below-page check. */
export const currentManagerChord = (): ManagerChord | null => current?.chord ?? null;

/**
 * Takes the manager chord system-wide: in front, it toggles the manager; from
 * another app, it brings T3 forward with the manager showing. Replaces the
 * previous registration; null releases it. Returns whether the OS granted it.
 */
export function registerManagerShortcut(
  chord: ManagerChord | null,
  window: Electron.BrowserWindow | null,
  platform: NodeJS.Platform,
): boolean {
  if (current?.accelerator) Electron.globalShortcut.unregister(current.accelerator);
  current = null;
  if (chord === null || window === null) return false;
  const accelerator = managerChordAccelerator(chord, platform);
  const registered =
    accelerator !== null &&
    Electron.globalShortcut.register(accelerator, () => {
      if (window.isDestroyed()) return;
      sendManagerAction(
        window,
        window.isFocused() && window.isVisible() ? TOGGLE_MANAGER_ACTION : OPEN_MANAGER_ACTION,
      );
    });
  current = { chord, window, accelerator: registered ? accelerator : null };
  return registered;
}
