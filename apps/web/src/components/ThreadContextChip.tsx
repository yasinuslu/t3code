import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadContextRecord } from "@t3tools/contracts";
import { formatThreadLinkHref } from "@t3tools/shared/threadLinks";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { useThreadShell } from "~/state/entities";
import { cn } from "~/lib/utils";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type ThreadLinkStatus = "needs-input" | "working" | "ready" | "settled";

const THREAD_LINK_STATUS = {
  "needs-input": { label: "Needs input", dotClass: "bg-amber-500 dark:bg-amber-300/90" },
  working: { label: "Working", dotClass: "bg-sky-500 dark:bg-sky-300/80" },
  ready: { label: "Ready", dotClass: "bg-emerald-500 dark:bg-emerald-300/90" },
  settled: { label: "Settled", dotClass: "bg-muted-foreground/50" },
} as const satisfies Record<ThreadLinkStatus, { label: string; dotClass: string }>;

function resolveThreadLinkStatus(
  shell: Pick<
    EnvironmentThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "runtime" | "settledOverride"
  >,
): ThreadLinkStatus {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return "needs-input";
  if (threadRuntimeIsActive(shell.runtime)) return "working";
  return shell.settledOverride === "settled" ? "settled" : "ready";
}

async function copyThreadLink(href: string) {
  try {
    await writeTextToClipboard(href, "link");
    toastManager.add({ type: "success", title: "Thread link copied" });
  } catch {
    toastManager.add({ type: "error", title: "Could not copy the link" });
  }
}

/**
 * Inline chip for a thread, in the composer, in sent messages and for `t3code://threads/...`
 * links in chat. Prefers the live title so a renamed thread never shows a stale label, shows
 * the thread's status and, for a thread on another environment, which one. Opens the thread on
 * click; Cmd/Ctrl-click and the context menu copy its link.
 */
export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  copyMarkdown?: string;
  /** The environment the chip is shown in (default: the primary one). A thread anywhere else names its environment. */
  currentEnvironmentId?: EnvironmentId | null | undefined;
}) {
  const { environmentId, threadId } = props.record;
  const navigate = useNavigate();
  const shell = useThreadShell({ environmentId, threadId });
  const environment = useEnvironment(environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const currentEnvironmentId = props.currentEnvironmentId ?? primaryEnvironmentId;
  const title = shell?.title?.trim() || props.record.title;
  const status = shell ? THREAD_LINK_STATUS[resolveThreadLinkStatus(shell)] : null;
  const environmentLabel =
    currentEnvironmentId !== null && currentEnvironmentId !== environmentId
      ? (environment?.label ?? null)
      : null;
  const href = formatThreadLinkHref({ environmentId, threadId });
  const openThread = () =>
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });

  const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    void copyThreadLink(href);
  };
  const onContextMenu = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    event.stopPropagation();
    void api.contextMenu
      .show(
        [
          { id: "open", label: "Open thread" },
          { id: "copy-link", label: "Copy link", icon: "copy" },
        ],
        { x: event.clientX, y: event.clientY },
      )
      .then((action) => {
        if (action === "open") openThread();
        else if (action === "copy-link") void copyThreadLink(href);
      })
      .catch(() => undefined);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="thread"
            {...(shell ? {} : { state: "unresolved" as const })}
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId }}
                onClick={onClick}
                onContextMenu={onContextMenu}
              />
            }
            aria-label={`Thread, ${title}${status ? `, ${status.label}` : ""}`}
            data-markdown-copy={props.copyMarkdown}
            className={cn("chat-markdown-chip no-underline", !shell && "text-muted-foreground")}
          >
            <MessagesSquareIcon />
            <ContextChipLabel>{title}</ContextChipLabel>
            {environmentLabel ? (
              <span className="shrink-0 font-normal text-muted-foreground">{environmentLabel}</span>
            ) : null}
            {status ? (
              <span
                aria-hidden="true"
                data-thread-status={status.label}
                className={cn("size-[0.45em] shrink-0 rounded-full", status.dotClass)}
              />
            ) : null}
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {shell
          ? `Open thread · ${status?.label}`
          : environment
            ? "Thread not available"
            : "Thread is on an environment that is not connected"}
      </TooltipPopup>
    </Tooltip>
  );
}
