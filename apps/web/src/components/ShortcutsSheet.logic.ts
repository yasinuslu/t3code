import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { shortcutLabelForCommand } from "../keybindings";

export interface ShortcutRow {
  readonly label: string;
  readonly keys: ReadonlyArray<string>;
}

export interface ShortcutSection {
  readonly id: string;
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
      { label: "Manager", commands: ["manager.toggle"] },
      { label: "Focus the sidebar", commands: ["pane.sidebar"] },
      { label: "Previous / next pane", commands: ["pane.left", "pane.right"] },
      { label: "Next / previous profile", commands: ["profile.next", "profile.previous"] },
      { label: "Command palette", commands: ["commandPalette.toggle"] },
      { label: "Find a file", commands: ["filePicker.toggle"] },
      { label: "Back / forward", commands: ["navigation.back", "navigation.forward"] },
      { label: "Settings", commands: ["settings.open"] },
      { label: "This sheet", commands: ["shortcuts.toggle"] },
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
      { label: "Presentation", commands: ["rightPanel.togglePresentation"] },
      { label: "Preview", commands: ["preview.toggle"] },
      { label: "Usage", commands: ["usage.open"] },
    ],
  },
];

/** The sheet's sections, with keys from the live keybindings so none is a second copy. */
export function buildShortcutSections(options: {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
}): ReadonlyArray<ShortcutSection> {
  return GLOBAL_ROWS.map(({ title, rows }) => ({
    id: `app-${title}`,
    title,
    rows: rows.flatMap(({ label, commands }) => {
      const keys = commands.flatMap((command) => {
        const shortcut = shortcutLabelForCommand(options.keybindings, command, {
          platform: options.platform,
        });
        return shortcut === null ? [] : [shortcut];
      });
      return keys.length === 0 ? [] : [{ label, keys }];
    }),
  })).filter((section) => section.rows.length > 0);
}
