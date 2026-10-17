import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { MessagesSquareIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useManagerThreadKeys, useThreadShellsWithoutBrainstorms } from "../../brainstormStore";
import { useForkFeatures } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import { openManager } from "../../lib/goToManager";
import { useAtomValue } from "@effect/atom-react";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The way to the manager from the thread list: always at the top, whatever
 * space or filter is active, with a dot while a manager is working. Managers
 * have no rows of their own in the lists; this opens the manager overlay.
 */
export const SidebarManagerEntry = memo(function SidebarManagerEntry() {
  return useForkFeatures() ? <ManagerEntry /> : null;
});

function ManagerEntry() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const managerKeys = useManagerThreadKeys();
  const allThreads = useThreadShellsWithoutBrainstorms();
  const managerWorking = useMemo(
    () =>
      allThreads.some(
        (thread) =>
          managerKeys.has(`${thread.environmentId}:${thread.id}`) &&
          threadRuntimeIsActive(thread.runtime),
      ),
    [allThreads, managerKeys],
  );
  const shortcut = shortcutLabelForCommand(keybindings, "manager.toggle");

  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-manager=""
              onClick={() => void openManager()}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-foreground/90 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <MessagesSquareIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Manager</span>
          {shortcut ? (
            <span className="shrink-0 text-muted-foreground text-xs">{shortcut}</span>
          ) : null}
          {managerWorking ? (
            <span
              aria-label="Manager is working"
              className="size-1.5 shrink-0 rounded-full bg-info"
            />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          Show the manager over any screen{shortcut ? ` · ${shortcut}` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
