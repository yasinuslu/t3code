/**
 * The profile chords (Ctrl+Option+Q, Shift to go back): step the code profile
 * in view, and the manager with it, through the profiles the servers report,
 * wrapping at both ends like the thumb buttons. A short-lived strip names the
 * profiles with the new one lit, so a press never goes unseen. App-global, so
 * it works from Grow, a thread or the manager.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { useBrainstormStore, useManagerProfile } from "../brainstormStore";
import { resolveShortcutCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { isTerminalFocused } from "../lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "../state/server";
import { adjacentManagerProfileChoice } from "./brainstorm/brainstorm.logic";
import { selectManagerProfile } from "./brainstorm/useOpenManagerThread";

const STRIP_MS = 1_200;

export function ProfileShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const profiles = useBrainstormStore((state) => state.profiles);
  const current = useManagerProfile();
  const [strip, setStrip] = useState<{ readonly profile: string; readonly at: number } | null>(
    null,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "profile.next" && command !== "profile.previous") return;
      event.preventDefault();
      event.stopPropagation();
      const next = adjacentManagerProfileChoice(
        profiles ?? [],
        current,
        command === "profile.next" ? 1 : -1,
      );
      if (next === null) return;
      selectManagerProfile(next);
      setStrip({ profile: next, at: Date.now() });
    };
    // Capture, so a focused editor or the chat cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, keybindings, profiles]);

  useEffect(() => {
    if (strip === null) return;
    const timer = window.setTimeout(() => setStrip(null), STRIP_MS);
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
