import { findSandboxForWorktree } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId, SandboxSummary } from "@t3tools/contracts";
import { BoxIcon } from "lucide-react";
import { memo } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const BACKEND_LABELS: Record<NonNullable<SandboxSummary["backend"]>, string> = {
  microsandbox: "microVM",
  docker: "Docker container",
};

/** One line naming where the thread runs, for tooltips and screen readers. */
export function describeSandbox(sandbox: SandboxSummary): string {
  const runtime = BACKEND_LABELS[sandbox.backend ?? "docker"];
  const state =
    sandbox.status === "running"
      ? ""
      : sandbox.status === "error"
        ? ` (error: ${sandbox.error ?? "unknown"})`
        : ` (${sandbox.status})`;
  return `Runs in a sandbox: an isolated ${runtime}${state}`;
}

/**
 * Marks a thread whose worktree runs in a sandbox: a small box icon on
 * sidebar rows, a "Sandbox" badge in the chat header. Renders nothing for
 * other threads. Mount it only for servers that report `sandboxes`.
 */
export const ThreadSandboxBadge = memo(function ThreadSandboxBadge(props: {
  readonly environmentId: EnvironmentId;
  readonly worktreePath: string;
  readonly variant: "icon" | "badge";
}) {
  const sandboxesQuery = useEnvironmentQuery(
    vcsEnvironment.sandboxes({ environmentId: props.environmentId, input: {} }),
  );
  const sandbox = findSandboxForWorktree(sandboxesQuery.data?.sandboxes, props.worktreePath);
  if (!sandbox) return null;
  const description = describeSandbox(sandbox);
  const iconClassName =
    sandbox.status === "error" ? "text-destructive-foreground" : "text-info-foreground";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          props.variant === "icon" ? (
            <span
              role="img"
              aria-label={description}
              data-sandbox-badge
              className="inline-flex shrink-0 items-center"
            />
          ) : (
            <Badge
              variant={sandbox.status === "error" ? "error" : "info"}
              size="sm"
              aria-label={description}
              data-sandbox-badge
            />
          )
        }
      >
        {props.variant === "icon" ? (
          <BoxIcon aria-hidden className={`size-3 ${iconClassName}`} />
        ) : (
          <>
            <BoxIcon aria-hidden />
            Sandbox
          </>
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
});
