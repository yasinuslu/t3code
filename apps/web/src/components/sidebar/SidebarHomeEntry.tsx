import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { classifyWorkThread } from "@t3tools/client-runtime/state/work-overview";
import { CompassIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useBrainstormStore, useThreadShellsWithoutBrainstorms } from "../../brainstormStore";
import { openManagerHome } from "../brainstorm/useOpenManagerThread";
import { shortcutLabelForCommand } from "../../keybindings";
import { useAtomValue } from "@effect/atom-react";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The way Home from anywhere: always at the top of the thread list, whatever
 * space or filter is active. Shows how many threads need the user and whether
 * the manager is working.
 */
export const SidebarHomeEntry = memo(function SidebarHomeEntry() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const managerThreadKey = useBrainstormStore((state) => state.managerThreadKey);
  const threads = useThreadShellsWithoutBrainstorms();
  const [now] = useState(() => Date.now());
  const { needsYou, managerWorking } = useMemo(() => {
    let count = 0;
    let working = false;
    for (const thread of threads) {
      if (`${thread.environmentId}:${thread.id}` === managerThreadKey) {
        working = threadRuntimeIsActive(thread.runtime);
        continue;
      }
      if (classifyWorkThread(thread, now)?.group === "needsMe") count += 1;
    }
    return { needsYou: count, managerWorking: working };
  }, [managerThreadKey, now, threads]);
  const shortcut = shortcutLabelForCommand(keybindings, "manager.open");

  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-home=""
              onClick={openManagerHome}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-foreground/90 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <CompassIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Home</span>
          <span className="shrink-0 text-muted-foreground text-xs">Manager</span>
          {managerWorking ? (
            <span
              aria-label="Manager is working"
              className="size-1.5 shrink-0 rounded-full bg-info"
            />
          ) : null}
          {needsYou > 0 ? (
            <span
              aria-label={`${needsYou} need you`}
              className="min-w-5 shrink-0 rounded-full bg-warning-surface px-1.5 text-center font-medium text-warning-foreground text-xs tabular-nums"
            >
              {needsYou}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          Home: your work and the manager{shortcut ? ` · ${shortcut}` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
