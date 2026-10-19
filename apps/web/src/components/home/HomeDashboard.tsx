/**
 * Home: the Grow workspace under a header with the spaces row. The manager
 * is a thread pinned at the top of the sidebar (see ManagerRoute); Grow
 * still shows it in its chat pane when it is selected.
 */
import { useEffect, useState } from "react";

import { useHomeThreadShells } from "../../brainstormStore";
import { isElectron } from "../../env";
import { useProjects } from "../../state/entities";
import ChatView from "../ChatView";
import { NotificationsBell } from "../NotificationsBell";
import { Spinner } from "../ui/spinner";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useManagerProfileMouseButtons } from "../brainstorm/ManagerProfileSwitcher";
import { GrowWorkspace } from "../grow/GrowWorkspace";
import { CodeProfileProbes, SpaceSwitcher } from "../sidebar/SpaceSwitcher";
import { useSpaceStore } from "../../spaceStore";
import { selectManagerProfile, useEnsureManagerThread } from "../brainstorm/useOpenManagerThread";
import { ManagerUnavailable } from "../brainstorm/ManagerUnavailable";

/** Time labels move on while the page stays open; a coarse tick is enough. */
const CLOCK_TICK_MS = 30_000;

export function HomeDashboard() {
  const threads = useHomeThreadShells();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const manager = useEnsureManagerThread();
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
            <NotificationsBell />
          </div>
        </WorkspacePageHeader>
        <GrowWorkspace
          threads={threads}
          now={now}
          managerPane={
            <section
              aria-label="Manager"
              data-home-manager=""
              className="flex min-h-0 min-w-0 flex-1 flex-col border-s"
            >
              {manager._tag === "Ready" ? (
                <ChatView
                  key={`${manager.environmentId}:${manager.threadId}`}
                  environmentId={manager.environmentId}
                  threadId={manager.threadId}
                  routeKind="server"
                  reserveTitleBarControlInset={false}
                  autoFocusComposer={false}
                  embedded
                />
              ) : manager._tag === "Failed" ? (
                <ManagerUnavailable message={manager.message} offline={manager.offline} />
              ) : (
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                  <Spinner />
                </div>
              )}
            </section>
          }
        />
      </div>
    </div>
  );
}
