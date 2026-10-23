import type * as Electron from "electron";
import { isMacTextEditingChord } from "@t3tools/shared/keybindings";

import { acceleratorKeyName, type ManagerChord } from "./ManagerShortcut.ts";

/**
 * The keys the shell itself acts on, below the page: the Window menu's profile windows, the
 * menu's Settings and zoom, and Grow's keys when they must reach Grow from a preview page that
 * swallows every key. The web app owns the keybindings (Settings › Keyboard); it reports the
 * chords it resolved and the shell works from that list. Until it does, the defaults stand.
 */
export interface ShellChord extends ManagerChord {
  /** The keybinding command, e.g. `window.profile.2` or `grow.step.next`. */
  readonly command: string;
}

const PROFILE_WINDOW_PREFIX = "window.profile.";

/**
 * The commands handed to the renderer from a preview page that swallows every key: Grow's keys
 * and the profile step, which also works from Grow. They depend on the window's screen (Grow
 * open or not), so each window reports its own.
 */
const isForwardedCommand = (command: string): boolean =>
  command.startsWith("grow.") || command === "profile.next" || command === "profile.previous";

/** The 1-based profile window a command opens, or null for any other command. */
export function profileWindowIndexOfCommand(command: string): number | null {
  if (!command.startsWith(PROFILE_WINDOW_PREFIX)) return null;
  const index = Number(command.slice(PROFILE_WINDOW_PREFIX.length));
  return Number.isInteger(index) && index >= 1 && index <= 9 ? index : null;
}

const chord = (command: string, key: string, modifiers: Partial<ManagerChord>): ShellChord => ({
  command,
  key,
  control: false,
  alt: false,
  meta: false,
  shift: false,
  ...modifiers,
});

/** The shipped chords, as `DEFAULT_KEYBINDINGS` has them (`mod` already resolved). */
export function defaultShellChords(platform: NodeJS.Platform): ReadonlyArray<ShellChord> {
  const mac = platform === "darwin";
  const mod = mac ? { meta: true } : { control: true };
  return [
    chord("settings.open", ",", mod),
    chord("zoom.in", "=", mod),
    chord("zoom.in", "+", mod),
    chord("zoom.out", "-", mod),
    chord("zoom.reset", "0", mod),
    ...Array.from({ length: 9 }, (_, index) =>
      chord(`${PROFILE_WINDOW_PREFIX}${index + 1}`, String(index + 1), {
        shift: true,
        ...(mac ? { control: true } : { alt: true }),
      }),
    ),
  ];
}

/** The chords every window shares (menu, profile windows), as the renderer last reported them. */
let reported: ReadonlyArray<ShellChord> | null = null;
/** The forwarded chords of each window (by webContents id), which follow its screen. */
const forwardedByWindow = new Map<number, ReadonlyArray<ShellChord>>();
const listeners = new Set<() => void>();

/**
 * Takes the chords a renderer resolved. The shared ones replace the last report (every window
 * resolves the same keybindings); the forwarded ones are kept per window, so one window's Grow
 * does not decide another window's keys.
 */
export function setShellChords(next: ReadonlyArray<ShellChord>, windowId?: number): void {
  const shared = next.filter((candidate) => !isForwardedCommand(candidate.command));
  const menuChanged = JSON.stringify(shared) !== JSON.stringify(reported ?? []);
  reported = shared;
  if (windowId !== undefined) {
    forwardedByWindow.set(
      windowId,
      next.filter((candidate) => isForwardedCommand(candidate.command)),
    );
  }
  if (menuChanged) for (const listener of listeners) listener();
}

/** Drops what a closed window reported. */
export function forgetShellChordsOf(windowId: number): void {
  forwardedByWindow.delete(windowId);
}

export function shellChords(
  platform: NodeJS.Platform,
  windowId?: number,
): ReadonlyArray<ShellChord> {
  const shared = reported ?? defaultShellChords(platform);
  const forwarded = windowId === undefined ? undefined : forwardedByWindow.get(windowId);
  return forwarded ? [...shared, ...forwarded] : shared;
}

/** Runs `listener` after the chords change, so the menu can show the new ones. */
export function onShellChordsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The physical key of an input, so Option-modified letters on macOS still match. */
function inputKey(input: Pick<Electron.Input, "key" | "code">): string {
  const code = input.code ?? "";
  const letter = code.match(/^Key([A-Z])$/)?.[1];
  if (letter) return letter.toLowerCase();
  const digit = code.match(/^Digit([0-9])$/)?.[1];
  if (digit) return digit;
  if (code === "Space") return " ";
  return input.key.toLowerCase();
}

/**
 * The commands whose chord a key press below the page is. Digits are compared by place, so a
 * layout that needs Shift for them (AZERTY) still matches. Null for a release or a repeat.
 */
export function shellCommandsOfInput(
  input: Pick<
    Electron.Input,
    "type" | "key" | "code" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
  >,
  platform: NodeJS.Platform,
  windowId?: number,
): ReadonlyArray<string> {
  if (input.type !== "keyDown" || input.isAutoRepeat) return [];
  const key = inputKey(input);
  return shellChords(platform, windowId)
    .filter(
      (candidate) =>
        candidate.key === key &&
        candidate.control === input.control &&
        candidate.alt === input.alt &&
        candidate.meta === input.meta &&
        candidate.shift === input.shift,
    )
    .map((candidate) => candidate.command);
}

/** The profile window (0-based) a key press opens, or null. */
export function profileWindowShortcutIndex(
  input: Parameters<typeof shellCommandsOfInput>[0],
  platform: NodeJS.Platform,
): number | null {
  for (const command of shellCommandsOfInput(input, platform)) {
    const index = profileWindowIndexOfCommand(command);
    if (index !== null) return index - 1;
  }
  return null;
}

/**
 * The command a key press below the page is, when it must be taken from the page and handed to
 * the renderer of `windowId` (a Grow key, or the profile step). A Mac Control+letter a text
 * field uses for editing (Ctrl+A, ...) stays with the page: a form in a preview would lose it.
 */
export function growCommandOfInput(
  input: Parameters<typeof shellCommandsOfInput>[0],
  platform: NodeJS.Platform,
  windowId: number,
): string | null {
  if (
    platform === "darwin" &&
    isMacTextEditingChord({
      key: inputKey(input),
      control: input.control,
      alt: input.alt,
      meta: input.meta,
      shift: input.shift,
    })
  ) {
    return null;
  }
  return shellCommandsOfInput(input, platform, windowId).find(isForwardedCommand) ?? null;
}

/** The Grow commands that take focus out of the page (to a place, search, the manager). */
export const growCommandLeavesPage = (command: string): boolean =>
  command === "grow.zone.threads" ||
  command === "grow.zone.presentation" ||
  command === "grow.zone.chat" ||
  command === "grow.back" ||
  command === "grow.search" ||
  command === "grow.manager";

/**
 * A menu accelerator for the chord, with `CmdOrCtrl` for the platform's primary key. Null for a
 * chord with no modifier, which a menu item cannot take.
 */
export function menuAccelerator(chord: ManagerChord, platform: NodeJS.Platform): string | null {
  const name = acceleratorKeyName(chord.key);
  if (name === null) return null;
  const mac = platform === "darwin";
  const modifiers = [
    // Control is the primary key off a Mac, Command on one.
    mac ? (chord.control ? "Control" : null) : chord.control ? "CmdOrCtrl" : null,
    mac ? (chord.meta ? "CmdOrCtrl" : null) : chord.meta ? "Super" : null,
    chord.alt ? "Alt" : null,
    chord.shift ? "Shift" : null,
  ].filter((modifier) => modifier !== null);
  return modifiers.length === 0 ? null : [...modifiers, name].join("+");
}
