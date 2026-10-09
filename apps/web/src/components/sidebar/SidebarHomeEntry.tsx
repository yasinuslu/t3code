import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { classifyWorkThread } from "@t3tools/client-runtime/state/work-overview";
import { CompassIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import {
  useHomeThreadShells,
  useManagerProfile,
  useManagerThreadKeys,
  useThreadShellsWithoutBrainstorms,
} from "../../brainstormStore";
import { openManagerHome, useOpenManagerThreadPage } from "../brainstorm/useOpenManagerThread";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { shortcutLabelForCommand } from "../../keybindings";
import { useAtomValue } from "@effect/atom-react";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The way Home from anywhere: always at the top of the thread list, whatever
 * space or filter is active. Shows how many of the active space's threads need
 * the user and whether a manager is working. Managers have no rows of their
 * own in the lists; on windows too narrow for Home's docked manager this opens
 * the active profile's manager thread.
 */
export const SidebarHomeEntry = memo(function SidebarHomeEntry() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const managerKeys = useManagerThreadKeys();
  const allThreads = useThreadShellsWithoutBrainstorms();
  const homeThreads = useHomeThreadShells();
  const [now] = useState(() => Date.now());
  const needsYou = useMemo(
    () =>
      homeThreads.filter((thread) => classifyWorkThread(thread, now)?.group === "needsMe").length,
    [homeThreads, now],
  );
  const managerWorking = useMemo(
    () =>
      allThreads.some(
        (thread) =>
          managerKeys.has(`${thread.environmentId}:${thread.id}`) &&
          threadRuntimeIsActive(thread.runtime),
      ),
    [allThreads, managerKeys],
  );
  const shortcut = shortcutLabelForCommand(keybindings, "manager.open");
  const narrow = useMediaQuery("max-lg");
  const managerProfile = useManagerProfile();
  const openManagerThreadPage = useOpenManagerThreadPage();
  const open = () => {
    if (!narrow) return openManagerHome();
    void openManagerThreadPage(managerProfile);
  };

  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-home=""
              onClick={open}
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
