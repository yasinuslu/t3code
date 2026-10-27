import type { ScopedThreadRef } from "@t3tools/contracts";
import { PlayIcon, SquareIcon } from "lucide-react";

import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { useProjects, useThreadShell } from "../../state/entities";
import { previewEnvironmentCommands } from "../../state/previewEnvironment";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Starts or stops the thread's preview environment: the project's t3.json `preview` commands,
 * read from the same checkout the server runs them in. Hidden when the project has none.
 */
export function PreviewEnvironmentControl({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const workspaceRoot =
    projects.find(
      (project) =>
        project.environmentId === thread?.environmentId && project.id === thread?.projectId,
    )?.workspaceRoot ?? null;
  const { file } = useT3ProjectFileState(
    threadRef.environmentId,
    thread?.worktreePath ?? workspaceRoot,
  );
  const run = useAtomCommand(previewEnvironmentCommands.set);
  if (!thread || file?.preview === undefined) return null;

  const status = thread.previewEnvironment?.status;
  const busy = status === "starting" || status === "stopping";
  const running = status === "running";
  if (running && file.preview.down === undefined) return null;
  const action = running ? "down" : "up";
  const label = busy
    ? status === "starting"
      ? "Starting preview..."
      : "Stopping preview..."
    : running
      ? "Stop preview"
      : status === "failed"
        ? `Preview failed${thread.previewEnvironment?.note ? `: ${thread.previewEnvironment.note}` : ""}. Start again`
        : "Start preview";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={busy}
            onClick={() =>
              void run({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId, action },
              })
            }
          />
        }
      >
        {busy ? <Spinner /> : running ? <SquareIcon /> : <PlayIcon />}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
