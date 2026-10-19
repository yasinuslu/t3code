import { useAtomValue } from "@effect/atom-react";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { MessagesSquareIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  useManagerProfile,
  useManagerThreadKeys,
  useThreadShellsWithoutBrainstorms,
} from "../../brainstormStore";
import { useForkFeatures } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import { openManager } from "../../lib/goToManager";
import { cn } from "../../lib/utils";
import { useManagerViewStore } from "../../managerViewStore";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The manager's row: pinned above the thread list whatever the space or filter,
 * tinted so it never reads as an ordinary thread. It opens the manager of the
 * profile in view in the main column; switching spaces switches the manager.
 */
export const SidebarManagerEntry = memo(function SidebarManagerEntry() {
  return useForkFeatures() ? <ManagerEntry /> : null;
});

function ManagerEntry() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const profile = useManagerProfile();
  const shown = useManagerViewStore((state) => state.shown);
  const managerKeys = useManagerThreadKeys();
  const allThreads = useThreadShellsWithoutBrainstorms();
  const working = useMemo(
    () =>
      allThreads.some(
        (thread) =>
          managerKeys.has(`${thread.environmentId}:${thread.id}`) &&
          threadRuntimeIsActive(thread.runtime),
      ),
    [allThreads, managerKeys],
  );
  const shortcut = shortcutLabelForCommand(keybindings, "manager.toggle");
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-manager=""
              aria-current={shown ? "page" : undefined}
              onClick={() => {
                // On a phone the list is a drawer over the page; the manager shows once it closes.
                if (isMobile) setOpenMobile(false);
                void openManager();
              }}
              className={cn(
                "flex h-10 w-full items-center gap-2 rounded-md border-l-2 border-primary px-(--sidebar-row-content-inset) text-left text-sidebar-foreground text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                // Tinted at rest so it never reads as a thread; lit while it is the page shown.
                shown
                  ? "bg-primary/20 ring-1 ring-inset ring-primary/50"
                  : "bg-primary/[0.06] hover:bg-primary/12",
              )}
            />
          }
        >
          <MessagesSquareIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="font-medium">Manager</span>
          {profile ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">{profile}</span>
          ) : null}
          <span className="flex-1" />
          {working ? (
            <span
              aria-label="Manager is working"
              className="size-1.5 shrink-0 rounded-full bg-info"
            />
          ) : shortcut ? (
            <span className="shrink-0 text-muted-foreground text-xs max-md:hidden">{shortcut}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">Manager{shortcut ? ` (${shortcut})` : ""}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
