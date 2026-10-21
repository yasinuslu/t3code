import { useAtomValue } from "@effect/atom-react";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { MessagesSquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { APP_MODES, cycleAppMode, setAppMode, useAppMode } from "../appMode";
import { useManagerThreadKeys, useThreadShellsWithoutBrainstorms } from "../brainstormStore";
import { useIsMobile } from "../hooks/useMediaQuery";
import {
  resolveShortcutCommand,
  systemWideShortcutForCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { cn, isMacPlatform } from "../lib/utils";
import { useManagerViewStore } from "../managerViewStore";
import { openManager, toggleManager } from "../lib/goToManager";
import { isTerminalFocused } from "../lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Button } from "./ui/button";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * One shortcut per mode, one that cycles them, and the Manager shortcut that
 * shows the manager from any screen and goes back. App-global, like the right-panel chords.
 */
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
      // These chords work in a terminal too, so a rebinding can spare it with `when`.
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command === "manager.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleManager();
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
  }, [keybindings]);

  // The desktop app takes the manager chord system-wide, so it works with
  // another app in front; it follows rebinding in keybindings.json.
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
    // Turning the fork features off unmounts this and frees the chord.
    return () => void setManagerShortcut(null).catch(() => undefined);
  }, [keybindings]);

  // The desktop shell catches the chord below the page, where an iframe or a
  // preview cannot swallow it, and system-wide while another app is in front.
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

/**
 * The app bar: the view switch (Grow or Threads) and a quick way to the
 * manager thread, fixed at the top left in every view, right after the
 * sidebar toggle (Grow has no sidebar, so there it starts at the edge). It
 * publishes its width as `--app-bar-width`, which the titlebar insets add, so
 * no header ever runs under it.
 */
export function ModeSwitch() {
  const mode = useAppMode();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const isMobile = useIsMobile();
  const managerOpen = useManagerViewStore((state) => state.shown) && mode === "normal";
  const managerWorking = useManagerWorking();
  const managerShortcut = shortcutLabelForCommand(keybindings, "manager.toggle");

  const measure = useCallback((bar: HTMLDivElement) => {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        "--app-bar-width",
        `calc(${bar.offsetWidth}px + var(--workspace-titlebar-control-gap))`,
      );
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-bar-width");
    };
  }, []);

  // Phones have the bottom tab bar (PhoneTabBar) instead.
  if (isMobile) return null;

  return (
    <div
      ref={measure}
      className={cn(
        "pointer-events-none fixed top-[var(--workspace-controls-top)] z-45 flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
        mode === "grow"
          ? "left-[var(--workspace-controls-left)]"
          : "left-[calc(var(--workspace-controls-left)+var(--workspace-titlebar-control-size)+var(--workspace-titlebar-control-gap))]",
      )}
      data-mode-switch=""
    >
      <ToggleGroup
        aria-label="View"
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant={managerOpen ? "secondary" : "ghost"}
              className="pointer-events-auto relative"
              aria-label="Manager"
              aria-pressed={managerOpen}
              data-app-bar-manager=""
              onClick={toggleManager}
            />
          }
        >
          <MessagesSquareIcon />
          {managerWorking ? (
            <span
              aria-label="Manager is working"
              className="absolute top-1 right-1 size-1.5 rounded-full bg-info"
            />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          Manager{managerShortcut ? ` (${managerShortcut})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** A manager of any profile is running a turn. */
function useManagerWorking() {
  const managerKeys = useManagerThreadKeys();
  const allThreads = useThreadShellsWithoutBrainstorms();
  return useMemo(
    () =>
      allThreads.some(
        (thread) =>
          managerKeys.has(`${thread.environmentId}:${thread.id}`) &&
          threadRuntimeIsActive(thread.runtime),
      ),
    [allThreads, managerKeys],
  );
}
