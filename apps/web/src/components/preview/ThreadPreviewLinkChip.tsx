import type {
  ScopedThreadRef,
  ThreadPreviewLink,
  ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { previewLinkLabel } from "@t3tools/client-runtime/state/preview-links";
import { MonitorIcon } from "lucide-react";
import { useCallback, useMemo, type MouseEvent } from "react";

import { cn } from "~/lib/utils";
import { usePreviewLinkStates } from "~/state/previewLinks";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  latestPreviewLink,
  previewLinkStatePresentation,
  type PreviewLinkStatePresentation,
} from "./threadPreviewLinkChip.logic";
import { showThreadPreviewLinkContextMenu } from "./threadPreviewLinkContextMenu";
import { useOpenThreadPreviewLink } from "./useOpenThreadPreviewLink";

const DOT_CLASS_NAME: Record<NonNullable<PreviewLinkStatePresentation["dot"]>, string> = {
  running: "bg-success",
  starting: "bg-warning",
  stopped: "border border-muted-foreground",
  failed: "bg-destructive",
};

/**
 * A thread's preview links as chips. `latest` (sidebar rows) shows the newest link with a "+N"
 * for the rest; `all` (chat header) shows every link. Mount it only when the thread has links,
 * so threads without previews never subscribe to preview status.
 */
export function ThreadPreviewLinks({
  threadRef,
  links,
  display,
  onBeforeOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly links: ReadonlyArray<ThreadPreviewLink>;
  readonly display: "latest" | "all";
  /** Runs before opening, e.g. a sidebar row activating its thread so the panel shows. */
  readonly onBeforeOpen?: (() => void) | undefined;
}) {
  // Rows only poll the link they show.
  const shown = useMemo(() => {
    if (display === "all") return links.map((link) => ({ link, others: 0 }));
    const latest = latestPreviewLink(links);
    return latest ? [latest] : [];
  }, [display, links]);
  const urls = useMemo(() => shown.map(({ link }) => link.url), [shown]);
  const states = usePreviewLinkStates(threadRef.environmentId, urls);
  const openLink = useOpenThreadPreviewLink();
  const unlink = useAtomCommand(threadEnvironment.unlinkPreview, { reportFailure: true });
  const open = useCallback(
    (url: string, state: ThreadPreviewLinkState) => {
      if (state !== "gone") onBeforeOpen?.();
      void openLink(threadRef, url, state);
    },
    [onBeforeOpen, openLink, threadRef],
  );
  const remove = useCallback(
    (url: string) => {
      void unlink({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, url },
      });
    },
    [threadRef, unlink],
  );

  return shown.map(({ link, others }) => (
    <ThreadPreviewLinkChip
      key={link.url}
      link={link}
      state={states.get(link.url) ?? "unknown"}
      others={others}
      onOpen={open}
      onRemove={remove}
    />
  ));
}

function ThreadPreviewLinkChip({
  link,
  state,
  others,
  onOpen,
  onRemove,
}: {
  readonly link: ThreadPreviewLink;
  readonly state: ThreadPreviewLinkState;
  readonly others: number;
  readonly onOpen: (url: string, state: ThreadPreviewLinkState) => void;
  readonly onRemove: (url: string) => void;
}) {
  const label = previewLinkLabel(link);
  const presentation = previewLinkStatePresentation(state);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen(link.url, state);
  };
  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void showThreadPreviewLinkContextMenu({
      url: link.url,
      position: { x: event.clientX, y: event.clientY },
      onOpen: () => onOpen(link.url, state),
      onRemove: () => onRemove(link.url),
    });
  };
  const ariaLabel = [
    `Preview ${label}`,
    presentation.label,
    others > 0 ? `and ${others} more` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            tone="muted"
            aria-label={ariaLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
          />
        }
      >
        <span className="contents font-normal text-xs">
          <MonitorIcon aria-hidden className="size-3 shrink-0" />
          <span
            className={cn("max-w-28 truncate", presentation.removed && "line-through opacity-60")}
          >
            {label}
          </span>
          {others > 0 ? <span className="tabular-nums">+{others}</span> : null}
          {presentation.dot ? (
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS_NAME[presentation.dot])}
            />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80">
        <span className="block truncate">{link.url}</span>
        {presentation.label ? (
          <span className="block text-muted-foreground">{presentation.label}</span>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}
