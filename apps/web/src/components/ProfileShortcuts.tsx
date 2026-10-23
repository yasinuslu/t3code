/**
 * The profile chord (Option+R on a Mac, Alt+R elsewhere, off while a terminal has focus; Shift goes back): steps
 * the code profile in view, and the manager with it, through the profiles the
 * servers report, wrapping at both ends like the thumb buttons. In Grow the bare
 * R key does the same (see grow.keys). A short-lived strip names the profiles
 * with the new one lit, so a press never goes unseen. App-global, so the chord
 * works from Grow, a thread or the manager.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { create } from "zustand";

import { managerProfileNow, useBrainstormStore } from "../brainstormStore";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { cn } from "../lib/utils";
import { isTerminalFocused } from "../lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { adjacentManagerProfileChoice } from "./brainstorm/brainstorm.logic";
import { selectManagerProfile } from "./brainstorm/useOpenManagerThread";

const STRIP_MS = 1_200;

/** The profile the strip lights, and when, so a second press restarts its timer. */
const useProfileStrip = create<{
  readonly strip: { readonly profile: string; readonly at: number } | null;
}>(() => ({ strip: null }));

/** Steps the profile in view (and its manager) forward or back, and shows the strip. */
export function stepProfile(direction: 1 | -1): void {
  const profiles = useBrainstormStore.getState().profiles ?? [];
  const next = adjacentManagerProfileChoice(profiles, managerProfileNow(), direction);
  if (next === null) return;
  selectManagerProfile(next);
  useProfileStrip.setState({ strip: { profile: next, at: Date.now() } });
}

export function ProfileShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const profiles = useBrainstormStore((state) => state.profiles);
  const strip = useProfileStrip((state) => state.strip);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      // On Windows AltGr reports Ctrl+Alt; AltGr+Q types @ on Turkish and German layouts.
      if (event.getModifierState?.("AltGraph")) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          editableFocus: isEditableFocused(event.target),
        },
      });
      if (command !== "profile.next" && command !== "profile.previous") return;
      event.preventDefault();
      event.stopPropagation();
      stepProfile(command === "profile.next" ? 1 : -1);
    };
    // Capture, so a focused editor or the chat cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  useEffect(() => {
    if (strip === null) return;
    const timer = window.setTimeout(() => useProfileStrip.setState({ strip: null }), STRIP_MS);
    return () => window.clearTimeout(timer);
  }, [strip]);

  if (strip === null || profiles === null) return null;
  return (
    <div
      role="status"
      aria-label={`Profile: ${strip.profile}`}
      className="pointer-events-none fixed inset-x-0 top-16 z-60 flex justify-center"
      data-profile-strip=""
    >
      <div className="flex items-center gap-1 rounded-full border bg-popover p-1 shadow-lg">
        {profiles.map((profile) => (
          <span
            key={profile}
            className={cn(
              "rounded-full px-3 py-1 font-medium text-sm",
              profile === strip.profile
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {profile}
          </span>
        ))}
      </div>
    </div>
  );
}
