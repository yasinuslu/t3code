import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { resolveShortcutCommand } from "../keybindings";
import { installPaneFocus, focusPaneNamed, movePane, stepPaneRow } from "../lib/paneFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useSidebar } from "./ui/sidebar";

const OPEN_DIALOG = '[data-slot="dialog-popup"], [data-slot="alert-dialog-popup"]';

/**
 * Keyboard-only movement around the screen. Ctrl+S jumps to the sidebar (Grow's list in
 * Grow), Ctrl+H and Ctrl+L step one pane left and right in screen order, and J / K step the
 * rows of the sidebar once it has focus. Caught in the capture phase so an editor, the
 * composer or a terminal cannot swallow the chord; a closed sidebar is opened first. Panes
 * are marked in the layouts with `data-pane` (see lib/paneFocus).
 */
export function PaneShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, state, setOpen } = useSidebar();

  useEffect(() => installPaneFocus(), []);

  useEffect(() => {
    // The sidebar slides in over a few frames; it takes focus once it is on screen.
    const openSidebar = () => {
      setOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => focusPaneNamed("sidebar")));
    };
    const sidebarClosed = !isMobile && state === "collapsed";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.getModifierState?.("AltGraph")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-keybinding-capture]")) return;
      if (document.querySelector(OPEN_DIALOG)) return;

      if (
        target instanceof HTMLElement &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        target.closest("[data-app-sidebar]")
      ) {
        const direction =
          event.key === "j" || event.key === "ArrowDown"
            ? 1
            : event.key === "k" || event.key === "ArrowUp"
              ? -1
              : null;
        if (direction !== null && stepPaneRow(target, direction)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused(), previewFocus: isPreviewFocused() },
      });
      if (command !== "pane.sidebar" && command !== "pane.left" && command !== "pane.right") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (command === "pane.sidebar") {
        if (!focusPaneNamed("sidebar") && sidebarClosed) openSidebar();
        return;
      }
      if (!movePane(command === "pane.left" ? -1 : 1) && command === "pane.left" && sidebarClosed) {
        openSidebar();
      }
    };
    // Capture, so a focused editor, the composer or a terminal cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isMobile, keybindings, setOpen, state]);

  return null;
}
