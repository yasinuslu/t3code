/**
 * Home: the Grow workspace under a header with the profile and machine of the
 * manager in view. The manager itself floats over every screen as an overlay
 * (see ManagerOverlay); Grow still shows it in its chat pane when it is selected.
 */
import { MessagesSquareIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { useHomeThreadShells } from "../../brainstormStore";
import { isElectron } from "../../env";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useProjects } from "../../state/entities";
import ChatView from "../ChatView";
import { NotificationsBell } from "../NotificationsBell";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ManagerMachineSwitcher } from "../brainstorm/ManagerMachineSwitcher";
import {
  ManagerProfileSwitcher,
  useManagerProfileMouseButtons,
} from "../brainstorm/ManagerProfileSwitcher";
import { GrowWorkspace } from "../grow/GrowWorkspace";
import { CodeProfileProbes } from "../sidebar/SpaceSwitcher";
import { openManager } from "../../lib/goToManager";
import { selectManagerProfile, useEnsureManagerThread } from "../brainstorm/useOpenManagerThread";
import { ManagerUnavailable } from "../brainstorm/ManagerOverlay";

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
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const managerShortcut = shortcutLabelForCommand(keybindings, "manager.toggle");
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
          <h1 className="font-medium text-sm">Grow</h1>
          <ManagerProfileSwitcher includeAll onSelect={selectManagerProfile} />
          <ManagerMachineSwitcher />
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <NotificationsBell />
            <Button
              size="xs"
              variant="outline"
              data-home-open-manager=""
              onClick={() => void openManager()}
            >
              <MessagesSquareIcon />
              Manager
              {managerShortcut ? (
                <span className="text-muted-foreground max-sm:hidden">{managerShortcut}</span>
              ) : null}
            </Button>
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
