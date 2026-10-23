/**
 * The keyboard cheat sheet: `?` anywhere outside a text box, or the keyboard button beside the
 * notifications bell, opens it; `?` again or Esc closes it. It lists Grow's keys and the
 * app-wide ones from the real keymaps (see ShortcutsSheet.logic), Grow's first while Grow is
 * showing.
 */
import { useAtomValue } from "@effect/atom-react";
import { KeyboardIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

import { useForkFeatures } from "../hooks/useSettings";
import { useHomeOverlayStore } from "../homeOverlayStore";
import { cn, isMacPlatform } from "../lib/utils";
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

/** Whether the sheet is showing, so Grow's own keys stay off behind it. */
export const useShortcutsSheetOpen = () => useShortcutsSheetStore((state) => state.open);

const SCOPE_TITLE = { grow: "In Grow", app: "Everywhere" } as const;

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
  const forkFeatures = useForkFeatures();
  const homeOpen = useHomeOverlayStore((state) => state.open);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.repeat || event.isComposing) return;
      // A bare key would collide with inline components and typing; the chord is Mod+/.
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      const { open: isOpen, setOpen } = useShortcutsSheetStore.getState();
      setOpen(!isOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;
  const platform = navigator.platform;
  const sections = buildShortcutSections({
    keybindings,
    platform,
    mac: isMacPlatform(platform),
    inGrow: homeOpen,
    growAvailable: forkFeatures,
  });
  // One column per scope, in the order the sections come: Grow's on the left while Grow shows.
  const columns = [...new Set(sections.map((section) => section.scope))].map((scope) => ({
    scope,
    sections: sections.filter((section) => section.scope === scope),
  }));
  return (
    <Dialog open onOpenChange={(next) => useShortcutsSheetStore.getState().setOpen(next)}>
      <DialogPopup className="max-w-3xl" data-shortcuts-sheet="">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className={cn("grid gap-x-10", columns.length > 1 && "sm:grid-cols-2")}>
            {columns.map(({ scope, sections: group }) => (
              <div key={scope}>
                <p className="pb-2 font-semibold text-sm">{SCOPE_TITLE[scope]}</p>
                {group.map((section) => (
                  <Section key={section.id} section={section} />
                ))}
              </div>
            ))}
          </div>
          <p className="pt-1 text-muted-foreground text-xs">
            <Kbd>?</Kbd> or <Kbd>Esc</Kbd> closes this.
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** The keyboard button for the top-right corner, beside the notifications bell. */
export function ShortcutsButton() {
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
        Keyboard shortcuts ({isMacPlatform(navigator.platform) ? "⌘/" : "Ctrl+/"})
      </TooltipPopup>
    </Tooltip>
  );
}
