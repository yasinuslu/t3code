import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { shortcutLabelForCommand } from "../keybindings";
import { GROW_KEY_HELP } from "./grow/grow.keys";

export interface ShortcutRow {
  readonly label: string;
  readonly keys: ReadonlyArray<string>;
}

export interface ShortcutSection {
  readonly id: string;
  /** Grow's own keys, or the ones that work in the whole app. */
  readonly scope: "grow" | "app";
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutRow>;
}

/**
 * The app-wide shortcuts the sheet lists, by what they open. Each row names its commands, never
 * their keys: the keys come from the live keybindings, so a remapped or removed shortcut shows
 * as it is, and a row with no key left is dropped.
 */
const GLOBAL_ROWS: ReadonlyArray<{
  readonly title: string;
  readonly rows: ReadonlyArray<{
    readonly label: string;
    readonly commands: ReadonlyArray<KeybindingCommand>;
  }>;
}> = [
  {
    title: "Go",
    rows: [
      { label: "Grow / Threads", commands: ["mode.cycle"] },
      { label: "Manager", commands: ["manager.toggle"] },
      { label: "Focus the sidebar", commands: ["pane.sidebar"] },
      { label: "Previous / next pane", commands: ["pane.left", "pane.right"] },
      { label: "Next / previous profile", commands: ["profile.next", "profile.previous"] },
      { label: "Command palette", commands: ["commandPalette.toggle"] },
      { label: "Find a file", commands: ["filePicker.toggle"] },
      { label: "Back / forward", commands: ["navigation.back", "navigation.forward"] },
    ],
  },
  {
    title: "Threads",
    rows: [
      { label: "New thread", commands: ["chat.new"] },
      { label: "Previous / next thread", commands: ["thread.previous", "thread.next"] },
      { label: "Settle thread", commands: ["thread.settle"] },
      { label: "Sidebar", commands: ["sidebar.toggle"] },
    ],
  },
  {
    title: "Panels",
    rows: [
      { label: "Terminal", commands: ["terminal.toggle"] },
      { label: "Diff", commands: ["diff.toggle"] },
      { label: "Preview", commands: ["preview.toggle"] },
      { label: "Usage", commands: ["usage.open"] },
    ],
  },
];

/** `Shift+R` as the platform writes it: a Mac shows the symbol, the rest the word. */
function growKeyLabel(key: string, mac: boolean): string {
  return key.startsWith("Shift+") ? `${mac ? "⇧" : "Shift+"}${key.slice(6)}` : key;
}

/**
 * The sheet's sections, in the order they show: Grow's keys first while Grow is open, the
 * app-wide ones first everywhere else. Grow's come from the table beside its key mapper and
 * the rest from the live keybindings, so neither is a second copy of a key.
 */
export function buildShortcutSections(options: {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
  readonly mac: boolean;
  readonly inGrow: boolean;
  /** Grow shows the conversation beside the proof (1024 px and up). */
  readonly split: boolean;
  /** Grow ships with the fork features; without them its keys are not listed. */
  readonly growAvailable: boolean;
}): ReadonlyArray<ShortcutSection> {
  const grow: ShortcutSection[] = options.growAvailable
    ? GROW_KEY_HELP.map(({ group, entries }) => ({
        id: `grow-${group}`,
        scope: "grow" as const,
        title: group,
        rows: entries
          .filter((entry) => !(entry.narrowOnly && options.split))
          .map(({ label, keys }) => ({
            label,
            keys: keys.map((key) => growKeyLabel(key, options.mac)),
          })),
      })).filter((section) => section.rows.length > 0)
    : [];
  const global: ShortcutSection[] = GLOBAL_ROWS.map(({ title, rows }) => ({
    id: `app-${title}`,
    scope: "app" as const,
    title,
    rows: rows.flatMap(({ label, commands }) => {
      const keys = commands.flatMap((command) => {
        const shortcut = shortcutLabelForCommand(options.keybindings, command, options.platform);
        return shortcut === null ? [] : [shortcut];
      });
      return keys.length === 0 ? [] : [{ label, keys }];
    }),
  })).filter((section) => section.rows.length > 0);
  return options.inGrow ? [...grow, ...global] : [...global, ...grow];
}
