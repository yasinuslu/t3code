/**
 * The Manager shortcut (Ctrl+E by default): shows the manager from any screen
 * and goes back. App-global, and on desktop also system-wide.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { resolveShortcutCommand, systemWideShortcutForCommand } from "../../keybindings";
import { openManager, toggleManager } from "../../lib/goToManager";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isMacPlatform } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";

export function ManagerShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global keydown listener
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "manager.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      toggleManager();
    };
    // Capture, so a focused editor or the chat cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  // The desktop app registers the chord system-wide and follows keybindings.json.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- desktop global shortcut registration
  useEffect(() => {
    const setManagerShortcut = window.desktopBridge?.setManagerShortcut;
    if (!setManagerShortcut) return;
    const mac = isMacPlatform(navigator.platform);
    const shortcut = systemWideShortcutForCommand(keybindings, "manager.toggle", mac);
    void setManagerShortcut(
      shortcut === null
        ? null
        : {
            key: shortcut.key,
            control: shortcut.ctrlKey || (shortcut.modKey && !mac),
            alt: shortcut.altKey,
            meta: shortcut.metaKey || (shortcut.modKey && mac),
            shift: shortcut.shiftKey,
          },
    ).catch(() => undefined);
    return () => void setManagerShortcut(null).catch(() => undefined);
  }, [keybindings]);

  // The desktop shell catches the chord below the page, where an iframe cannot swallow it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- desktop menu action subscription
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction?.((action) => {
        if (action === "toggle-manager") toggleManager();
        else if (action === "open-manager") void openManager();
      }),
    [],
  );

  return null;
}
