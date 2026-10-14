import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { APP_MODES, cycleAppMode, setAppMode, useAppMode } from "../appMode";
import { useManagerProfile } from "../brainstormStore";
import { useIsMobile } from "../hooks/useMediaQuery";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { goToManager } from "../lib/goToManager";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useOpenManagerThreadPage } from "./brainstorm/useOpenManagerThread";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * One shortcut per mode, one that cycles them, and the Manager shortcut that
 * works from any screen. App-global, like the right-panel chords.
 */
export function ModeShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openManagerThreadPage = useOpenManagerThreadPage();
  const managerProfile = useManagerProfile();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      // The Manager shortcut has to work in a terminal too. Its `when` only
      // spares Ctrl+E there (the shell's end-of-line), which is not a chord on a Mac.
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: !isMacPlatform(navigator.platform) && isTerminalFocused() },
      });
      if (command === "manager.open" || command === "mode.classic") {
        event.preventDefault();
        event.stopPropagation();
        void goToManager(() => openManagerThreadPage(managerProfile));
        return;
      }
      if (command === "mode.cycle") {
        event.preventDefault();
        event.stopPropagation();
        cycleAppMode();
        return;
      }
      const target = APP_MODES.find((entry) => entry.command === command);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      setAppMode(target.mode);
    };
    // Capture, so a focused editor or the chat cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, managerProfile, openManagerThreadPage]);

  // The desktop shell catches the chord below the page, where an iframe or a
  // preview cannot swallow it, and sends it here.
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction?.((action) => {
        if (action === "open-manager") {
          void goToManager(() => openManagerThreadPage(managerProfile));
        }
      }),
    [managerProfile, openManagerThreadPage],
  );

  return null;
}

/**
 * The switch between Grow, the classic Manager and normal T3. Fixed at the top
 * centre of the page area so it sits in the same spot in every mode, above Home.
 */
export function ModeSwitch() {
  const mode = useAppMode();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const isMobile = useIsMobile();

  // Phones have the bottom tab bar (PhoneTabBar); here the switch would sit on the header text.
  if (isMobile) return null;

  return (
    <div
      className="pointer-events-none fixed top-[var(--workspace-controls-top)] left-(--mode-switch-center) z-50 flex h-[var(--workspace-topbar-height)] -translate-x-1/2 items-center [-webkit-app-region:no-drag]"
      data-mode-switch=""
    >
      <ToggleGroup
        aria-label="App mode"
        className="pointer-events-auto"
        value={[mode]}
        onValueChange={(next) => {
          const value = APP_MODES.find((entry) => entry.mode === next[0]);
          if (value) setAppMode(value.mode);
        }}
      >
        {APP_MODES.map((entry) => {
          // The Manager tab advertises the chord that gets there from anywhere.
          const shortcut =
            (entry.mode === "classic"
              ? shortcutLabelForCommand(keybindings, "manager.open")
              : null) ?? shortcutLabelForCommand(keybindings, entry.command);
          return (
            <Tooltip key={entry.mode}>
              <TooltipTrigger
                render={
                  <Toggle value={entry.mode} data-mode={entry.mode} aria-label={entry.label} />
                }
              >
                {entry.label}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {entry.label}
                {shortcut ? ` (${shortcut})` : ""}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
