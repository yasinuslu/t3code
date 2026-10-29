import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  deriveBackgroundCommands,
  type BackgroundCommand,
} from "@t3tools/client-runtime/state/background-commands";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { RadioTowerIcon, TerminalIcon } from "lucide-react";

import { openBackgroundCommand } from "../../backgroundCommandDialogStore";
import { tickTextContent } from "~/lib/tickTextContent";
import { cn } from "~/lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
import { deriveThreadPendingBackgroundTasks } from "../ChatView.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

/** Every background command and monitor a thread started, newest first. */
export function useBackgroundCommands(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ReadonlyArray<BackgroundCommand> {
  const projection = useQuietThreadProjection(scopeThreadRef(environmentId, threadId))?.projection;
  if (projection === undefined) return [];
  // The roster names work while a run is active; derived work covers providers without one.
  const pendingTasks = new Map(
    [
      ...projection.providerThreads.flatMap((thread) => thread.pendingBackgroundTasks ?? []),
      ...deriveThreadPendingBackgroundTasks(projection),
    ].map((task) => [task.taskId, task]),
  );
  return deriveBackgroundCommands({
    turnItems: projection.turnItems,
    pendingTasks: [...pendingTasks.values()],
  });
}

export function BackgroundCommandIcon(props: {
  readonly kind: BackgroundCommand["kind"];
  readonly className?: string;
}) {
  const Icon = props.kind === "monitor" ? RadioTowerIcon : TerminalIcon;
  return <Icon aria-hidden className={props.className} />;
}

/** Commands and monitors the agent runs in the background. Hidden while there are none. */
export function BackgroundCommandsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const commands = useBackgroundCommands(props.environmentId, props.threadId);
  if (commands.length === 0) return null;
  const runningCount = commands.filter((command) => command.running).length;
  return (
    <ThreadDetailsSection
      headingId="thread-details-background-commands-heading"
      title={
        runningCount > 0 ? `Background commands · ${runningCount} running` : "Background commands"
      }
    >
      {/* ScrollArea's max-height viewport measures badly inside this scrolling panel. */}
      <ul
        aria-label="Background commands"
        className="m-0 max-h-[13.5rem] list-none overflow-y-auto overscroll-contain p-0"
      >
        {commands.map((command) => {
          const startedAtMs = command.startedAt === null ? null : Date.parse(command.startedAt);
          return (
            <li key={command.taskId}>
              <ThreadDetailsControl
                size="sm"
                variant="ghost"
                part="row"
                aria-label={`${command.running ? "Running" : "Finished"} ${command.kind}: ${command.label}`}
                onClick={() =>
                  openBackgroundCommand({
                    environmentId: props.environmentId,
                    threadId: props.threadId,
                    taskId: command.taskId,
                  })
                }
              >
                <span className="relative flex shrink-0">
                  <BackgroundCommandIcon
                    kind={command.kind}
                    className={cn(
                      THREAD_DETAILS_PANEL_ICON_CLASS,
                      !command.running && "opacity-60",
                    )}
                  />
                  {command.running ? (
                    <span
                      aria-hidden
                      className="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-info"
                    />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-sm font-medium leading-4",
                    command.running ? "text-foreground/85" : "text-muted-foreground",
                  )}
                >
                  {command.label}
                </span>
                {command.running && startedAtMs !== null ? (
                  <span
                    ref={tickTextContent(
                      (nowMs) => formatDuration(Math.max(1_000, nowMs - startedAtMs)),
                      true,
                    )}
                    className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground"
                  />
                ) : null}
              </ThreadDetailsControl>
            </li>
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}
