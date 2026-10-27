/**
 * The keyboard cheat sheet: Mod+/ or Mod+? anywhere, or the keyboard button in the chat header,
 * opens it; the chord again or Esc closes it. It lists the keys from the real keymaps (see
 * ShortcutsSheet.logic).
 */
import { useAtomValue } from "@effect/atom-react";
import { KeyboardIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";

import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { buildShortcutSections, type ShortcutSection } from "./ShortcutsSheet.logic";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const useShortcutsSheetStore = create<{
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

function Section({ section }: { readonly section: ShortcutSection }) {
  return (
    <section className="pb-4">
      <h3 className="pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {section.title}
      </h3>
      <ul className="flex flex-col">
        {section.rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="min-w-0">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShortcutsSheet() {
  const open = useShortcutsSheetStore((state) => state.open);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      // Recording a shortcut in Settings gets every key, this chord included.
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-keybinding-capture]")) return;
      // A bare key would collide with inline components and typing; the chord is Mod+/ (or Mod+?) by default.
      if (resolveShortcutCommand(event, keybindings) !== "shortcuts.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      const { open: isOpen, setOpen } = useShortcutsSheetStore.getState();
      setOpen(!isOpen);
    };
    // Capture, so the composer, an editor or a terminal with focus cannot swallow the chord.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  if (!open) return null;
  const sections = buildShortcutSections({ keybindings, platform: navigator.platform });
  return (
    <Dialog open onOpenChange={(next) => useShortcutsSheetStore.getState().setOpen(next)}>
      <DialogPopup className="max-w-3xl" data-shortcuts-sheet="">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-x-10 sm:grid-cols-2">
            {sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
          <p className="pt-1 text-muted-foreground text-xs">
            <Kbd>Esc</Kbd> closes this. Every key can be changed in{" "}
            <Link
              to="/settings/keybindings"
              className="underline underline-offset-2"
              onClick={() => useShortcutsSheetStore.getState().setOpen(false)}
            >
              Settings › Keybindings
            </Link>
            .
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The keyboard button for the top-right corner of the chat header. */
export function ShortcutsButton() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "shortcuts.toggle");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Keyboard shortcuts"
            className="max-sm:hidden"
            data-shortcuts-button=""
            onClick={() => useShortcutsSheetStore.getState().setOpen(true)}
          />
        }
      >
        <KeyboardIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        Keyboard shortcuts{shortcut ? ` (${shortcut})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
