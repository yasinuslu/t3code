import { PlayIcon, SquareIcon } from "lucide-react";
import { useMemo } from "react";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { useProjects } from "../../state/entities";
import { growEnvironment } from "../../state/grow";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

/**
 * The thread's preview environment: the project's t3.json `preview` commands, read from the same
 * checkout the server runs them in, and where the last start or stop stands.
 */
export function usePreviewEnvironment(thread: EnvironmentThreadShell) {
  const projects = useProjects();
  const workspaceRoot = useMemo(
    () =>
      projects.find(
        (project) =>
          project.environmentId === thread.environmentId && project.id === thread.projectId,
      )?.workspaceRoot ?? null,
    [projects, thread.environmentId, thread.projectId],
  );
  const { file } = useT3ProjectFileState(
    thread.environmentId,
    thread.worktreePath ?? workspaceRoot,
  );
  const run = useAtomCommand(growEnvironment.previewEnvironment);
  const environment = thread.previewEnvironment;
  return {
    canStart: file?.preview !== undefined,
    canStop: file?.preview?.down !== undefined,
    status: environment?.status,
    note: environment?.note,
    start: () =>
      void run({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, action: "up" },
      }),
    stop: () =>
      void run({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, action: "down" },
      }),
  };
}

/** Start the preview for a thread that has none, when its project says how. */
export function StartPreviewButton(props: { readonly thread: EnvironmentThreadShell }) {
  const preview = usePreviewEnvironment(props.thread);
  if (!preview.canStart) return null;
  const busy = preview.status === "starting" || preview.status === "stopping";
  const failed = preview.status === "failed";
  return (
    <>
      {failed && preview.note ? (
        <span className="min-w-0 truncate text-muted-foreground text-xs">{preview.note}</span>
      ) : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={preview.start}>
        <PlayIcon />
        {preview.status === "starting"
          ? "Starting preview..."
          : preview.status === "stopping"
            ? "Stopping preview..."
            : failed
              ? "Try again"
              : "Start preview"}
      </Button>
    </>
  );
}

/** Stop a running preview environment, when the project says how. */
export function StopPreviewButton(props: { readonly thread: EnvironmentThreadShell }) {
  const preview = usePreviewEnvironment(props.thread);
  const stopping = preview.status === "stopping";
  if ((preview.status !== "running" && !stopping) || !preview.canStop) return null;
  return (
    <Button variant="ghost" size="sm" disabled={stopping} onClick={preview.stop}>
      <SquareIcon />
      {stopping ? "Stopping preview..." : "Stop preview"}
    </Button>
  );
}
