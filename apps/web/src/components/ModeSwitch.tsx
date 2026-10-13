import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { APP_MODES, cycleAppMode, setAppMode, useAppMode } from "../appMode";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** One shortcut per mode, and one that cycles them. App-global, like the right-panel chords. */
export function ModeShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings);
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
  }, [keybindings]);

  return null;
}

/**
 * The switch between Grow, the classic Manager and normal T3. Fixed at the top
 * centre of the window so it sits in the same spot in every mode, above Home.
 */
export function ModeSwitch() {
  const mode = useAppMode();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  return (
    <div
      className="pointer-events-none fixed top-[var(--workspace-controls-top)] left-1/2 z-50 flex h-[var(--workspace-topbar-height)] -translate-x-1/2 items-center [-webkit-app-region:no-drag]"
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
          const shortcut = shortcutLabelForCommand(keybindings, entry.command);
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
