/**
 * Home: Grow, what came back from the agents, under a header with the spaces
 * row. The manager is a thread of its own (see ManagerRoute), one button away
 * on the app bar.
 */
import { useEffect, useState } from "react";

import { useHomeThreadShells } from "../../brainstormStore";
import { isElectron } from "../../env";
import { useProjects } from "../../state/entities";
import { NotificationsBell } from "../NotificationsBell";
import { ShortcutsButton } from "../ShortcutsSheet";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useManagerProfileMouseButtons } from "../brainstorm/ManagerProfileSwitcher";
import { GrowReturns } from "../grow/GrowReturns";
import { CodeProfileProbes, SpaceSwitcher } from "../sidebar/SpaceSwitcher";
import { useSpaceStore } from "../../spaceStore";
import { selectManagerProfile } from "../brainstorm/useOpenManagerThread";

/** Time labels move on while the page stays open; a coarse tick is enough. */
const CLOCK_TICK_MS = 30_000;

export function HomeDashboard() {
  const threads = useHomeThreadShells();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const projects = useProjects();
  // Thumb buttons anywhere on Home switch profiles like they switch spaces over the sidebar.
  useManagerProfileMouseButtons({
    regionSelector: "[data-home-dashboard-root]",
    includeAll: true,
    onSelect: selectManagerProfile,
  });

  return (
    <div
      data-home-dashboard-root=""
      data-home-view="grow"
      className="flex h-full min-h-0 flex-col overflow-hidden overscroll-y-none bg-background"
    >
      {/* Cards sort by profile; phones may not have shown the sidebar that detects them. */}
      <CodeProfileProbes projects={projects} />
      {/* Home has its own canvas so the cards read as one board, apart from thread views. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40" data-home-dashboard="">
        <WorkspacePageHeader
          electron={isElectron}
          reserveNativeControls={false}
          // Home covers the sidebar, so its header clears the window controls itself.
          className="pl-(--home-header-start)"
        >
          {/* The same spaces row as the thread list's, in the same top-left spot after
              the app bar; the manager follows the active space's profile. */}
          <SpaceSwitcher onSwitch={(spaceId) => useSpaceStore.getState().setActiveSpace(spaceId)} />
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <ShortcutsButton />
            <NotificationsBell />
          </div>
        </WorkspacePageHeader>
        <GrowReturns threads={threads} now={now} />
      </div>
    </div>
  );
}
