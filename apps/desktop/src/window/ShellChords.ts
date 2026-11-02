import type * as Electron from "electron";

import { acceleratorKeyName, type ManagerChord } from "./ManagerShortcut.ts";

/**
 * The keys the shell itself acts on, below the page: the Window menu's profile windows and the
 * menu's Settings and zoom. The web app owns the keybindings (Settings › Keyboard); it reports the
 * chords it resolved and the shell works from that list. Until it does, the defaults stand.
 */
export interface ShellChord extends ManagerChord {
  /** The keybinding command, e.g. `window.profile.2`. */
  readonly command: string;
}

const PROFILE_WINDOW_PREFIX = "window.profile.";

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

/** The chords as the renderer last reported them. */
let reported: ReadonlyArray<ShellChord> | null = null;
const listeners = new Set<() => void>();

/** Takes the chords a renderer resolved; every window resolves the same keybindings. */
export function setShellChords(next: ReadonlyArray<ShellChord>): void {
  const changed = JSON.stringify(next) !== JSON.stringify(reported ?? []);
  reported = next;
  if (changed) for (const listener of listeners) listener();
}

export function shellChords(platform: NodeJS.Platform): ReadonlyArray<ShellChord> {
  return reported ?? defaultShellChords(platform);
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
): ReadonlyArray<string> {
  if (input.type !== "keyDown" || input.isAutoRepeat) return [];
  const key = inputKey(input);
  return shellChords(platform)
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
