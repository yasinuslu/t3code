import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { useHomeOverlayStore } from "../homeOverlayStore";
import { effectiveShortcutsForCommands } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";

/** The commands the desktop shell acts on itself, below the page. */
const isShellCommand = (command: string) =>
  command.startsWith("grow.") ||
  command === "profile.next" ||
  command === "profile.previous" ||
  command.startsWith("window.profile.") ||
  command === "settings.open" ||
  command.startsWith("zoom.");

/**
 * Tells the desktop app which chords it acts on below the page: the profile windows, the menu's
 * Settings and zoom items (their accelerators), and Grow's keys, which it hands to Grow from a
 * preview page that swallows every key. Resolved from the live keybindings, so a rebound key
 * moves in the shell as well. Grow's keys are only reported while Grow shows: a preview in the
 * full view keeps all of its own keys.
 */
export function ShellShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const growOpen = useHomeOverlayStore((state) => state.open);

  useEffect(() => {
    const setShellChords = window.desktopBridge?.setShellChords;
    if (!setShellChords) return;
    const mac = isMacPlatform(navigator.platform);
    const chords = effectiveShortcutsForCommands(keybindings, isShellCommand, {
      context: { growOpen },
    })
      // The profile step is global, but it is only taken from a preview page while Grow shows.
      .filter(({ command }) => growOpen || !command.startsWith("profile."))
      .map(({ command, shortcut }) => ({
        command,
        key: shortcut.key,
        control: shortcut.ctrlKey || (shortcut.modKey && !mac),
        alt: shortcut.altKey,
        meta: shortcut.metaKey || (shortcut.modKey && mac),
        shift: shortcut.shiftKey,
      }));
    void setShellChords(chords).catch(() => undefined);
  }, [growOpen, keybindings]);

  return null;
}
