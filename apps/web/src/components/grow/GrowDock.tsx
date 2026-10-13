import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ReactNode } from "react";

import { useManagerProfile } from "../../brainstormStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import ChatView from "../ChatView";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { growCardKey } from "./grow.logic";
import { useGrowFocusStore } from "./grow.store";

/**
 * The right column of Home's board view. Unfocused it is just the manager
 * (`manager`); in focus mode it switches between the focused thread's chat
 * and the manager, mounting only the selected one. The switch names both
 * sides so it is never unclear which chat a message goes to.
 */
export function GrowDock(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** The manager pane, as the board shows it without focus. */
  readonly manager: ReactNode;
}) {
  const wide = useMediaQuery("lg");
  const focusedKey = useGrowFocusStore((store) => store.focusedKey);
  const dockTab = useGrowFocusStore((store) => store.dockTab);
  const setDockTab = useGrowFocusStore((store) => store.setDockTab);
  const profile = useManagerProfile();
  const thread =
    focusedKey === null ? undefined : props.threads.find((t) => growCardKey(t) === focusedKey);
  if (!wide || focusedKey === null || thread === undefined) return props.manager;

  const tab = dockTab;
  return (
    <div className="flex min-h-0 min-w-0 flex-col" data-grow-dock={tab}>
      <ToggleGroup
        aria-label="Chat"
        className="m-2 w-auto *:min-w-0 *:flex-1"
        value={[tab]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "thread" || value === "manager") setDockTab(value);
        }}
      >
        <Toggle value="thread" title={`Thread: ${thread.title}`}>
          <span className="truncate">Thread: {thread.title}</span>
        </Toggle>
        <Toggle value="manager" title="Manager">
          <span className="truncate">{profile === null ? "Manager" : `Manager: ${profile}`}</span>
        </Toggle>
      </ToggleGroup>
      {tab === "thread" ? (
        <section
          aria-label={`Thread: ${thread.title}`}
          className="flex min-h-0 min-w-0 flex-1 flex-col border-s"
        >
          <ChatView
            key={`${thread.environmentId}:${thread.id}`}
            environmentId={thread.environmentId}
            threadId={thread.id}
            routeKind="server"
            reserveTitleBarControlInset={false}
          />
        </section>
      ) : (
        props.manager
      )}
    </div>
  );
}
