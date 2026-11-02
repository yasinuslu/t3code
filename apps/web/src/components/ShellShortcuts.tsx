import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { effectiveShortcutsForCommands } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";

/** The commands the desktop shell acts on itself, below the page. */
const isShellCommand = (command: string) =>
  command === "profile.next" ||
  command === "profile.previous" ||
  command.startsWith("window.profile.") ||
  command === "settings.open" ||
  command.startsWith("zoom.");

/**
 * Tells the desktop app which chords it acts on below the page: the profile windows and the menu's
 * Settings and zoom items (their accelerators). Resolved from the live keybindings, so a rebound
 * key moves in the shell as well.
 */
export function ShellShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the shell chords to the desktop shell
  useEffect(() => {
    const setShellChords = window.desktopBridge?.setShellChords;
    if (!setShellChords) return;
    const mac = isMacPlatform(navigator.platform);
    const chords = effectiveShortcutsForCommands(keybindings, isShellCommand)
      // The profile step is global, but a preview page keeps it.
      .filter(({ command }) => !command.startsWith("profile."))
      .map(({ command, shortcut }) => ({
        command,
        key: shortcut.key,
        control: shortcut.ctrlKey || (shortcut.modKey && !mac),
        alt: shortcut.altKey,
        meta: shortcut.metaKey || (shortcut.modKey && mac),
        shift: shortcut.shiftKey,
      }));
    void setShellChords(chords).catch(() => undefined);
  }, [keybindings]);

  return null;
}
