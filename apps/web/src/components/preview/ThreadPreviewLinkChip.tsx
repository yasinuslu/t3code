import type {
  ScopedThreadRef,
  ThreadPreviewLink,
  ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { previewLinkLabel } from "@t3tools/client-runtime/state/preview-links";
import { MonitorIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, type MouseEvent, type SyntheticEvent } from "react";

import { cn } from "~/lib/utils";
import { usePreviewLinkStates } from "~/state/previewLinks";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  latestPreviewLink,
  previewLinkStatePresentation,
  previewLinksNewestFirst,
  type PreviewLinkStatePresentation,
} from "./threadPreviewLinkChip.logic";
import { showThreadPreviewLinkContextMenu } from "./threadPreviewLinkContextMenu";
import { openPreviewLinkExternally, useOpenThreadPreviewLink } from "./useOpenThreadPreviewLink";

const DOT_CLASS_NAME: Record<NonNullable<PreviewLinkStatePresentation["dot"]>, string> = {
  running: "bg-success",
  starting: "bg-warning",
  stopped: "border border-muted-foreground",
  failed: "bg-destructive",
};

type OpenLink = (url: string, state: ThreadPreviewLinkState) => void;
type RemoveLink = (url: string) => void;

/** The chips sit inside clickable rows; nothing they do may activate or drag the row. */
const stopRow = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Middle-click opens a link in the system browser, like middle-clicking a link in a browser. The
 * mousedown default starts autoscroll and the auxclick default is the Linux primary paste, so both
 * are cancelled. A removed preview has nothing to open, as with a left click.
 */
const middleClickOpensExternally = (url: string, state: ThreadPreviewLinkState) => ({
  onMouseDown: (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  },
  onAuxClick: (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (state !== "gone") openPreviewLinkExternally(url);
  },
});

/**
 * A thread's preview links: the newest as a chip, the rest behind a "+N" that opens a list of
 * every link. Mount it only when the thread has links, so threads without previews never
 * subscribe to preview status. Only the chip's link is polled; the list polls while open.
 */
export function ThreadPreviewLinks({
  threadRef,
  links,
  onBeforeOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly links: ReadonlyArray<ThreadPreviewLink>;
  /** Runs before opening, e.g. a sidebar row activating its thread so the panel shows. */
  readonly onBeforeOpen?: (() => void) | undefined;
}) {
  const latest = useMemo(() => latestPreviewLink(links), [links]);
  const urls = useMemo(() => (latest ? [latest.link.url] : []), [latest]);
  const states = usePreviewLinkStates(threadRef.environmentId, urls);
  const openLink = useOpenThreadPreviewLink();
  const unlink = useAtomCommand(threadEnvironment.unlinkPreview, { reportFailure: true });
  const open = useCallback<OpenLink>(
    (url, state) => {
      if (state !== "gone") onBeforeOpen?.();
      void openLink(threadRef, url, state);
    },
    [onBeforeOpen, openLink, threadRef],
  );
  const remove = useCallback<RemoveLink>(
    (url) => {
      void unlink({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, url },
      });
    },
    [threadRef, unlink],
  );
  if (!latest) return null;

  return (
    <>
      <ThreadPreviewLinkChip
        link={latest.link}
        state={states.get(latest.link.url) ?? "unknown"}
        onOpen={open}
        onRemove={remove}
      />
      {latest.others > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <InlineButton
                tone="muted"

                aria-label={`${latest.others} more previews`}
                onPointerDown={stopRow}
                onClick={stopRow}
              />
            }
          >
            <span className="font-normal text-xs tabular-nums">+{latest.others}</span>
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="start" width="lg" padding="compact">
            <PopoverTitle className="sr-only">Linked previews</PopoverTitle>
            <ThreadPreviewLinkList
              threadRef={threadRef}
              links={links}
              onOpen={open}
              onRemove={remove}
            />
          </PopoverPopup>
        </Popover>
      ) : null}
    </>
  );
}

/** Every linked preview, newest first, each with its status, a way to open it and a way out. */
export function ThreadPreviewLinkList({
  threadRef,
  links,
  onOpen,
  onRemove,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly links: ReadonlyArray<ThreadPreviewLink>;
  readonly onOpen: OpenLink;
  readonly onRemove: RemoveLink;
}) {
  const ordered = useMemo(() => previewLinksNewestFirst(links), [links]);
  const urls = useMemo(() => ordered.map((link) => link.url), [ordered]);
  const states = usePreviewLinkStates(threadRef.environmentId, urls);
  return (
    <ul className="flex flex-col" onPointerDown={stopRow} onClick={stopRow}>
      {ordered.map((link) => {
        const state = states.get(link.url) ?? "unknown";
        const label = previewLinkLabel(link);
        const presentation = previewLinkStatePresentation(state);
        return (
          <li key={link.url} className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={[`Open preview ${label}`, presentation.label].filter(Boolean).join(", ")}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => onOpen(link.url, state)}
              {...middleClickOpensExternally(link.url, state)}
            >
              <MonitorIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate text-sm",
                    presentation.removed && "line-through opacity-60",
                  )}
                >
                  {label}
                </span>
                <span className="truncate text-muted-foreground text-xs">{link.url}</span>
              </span>
              {presentation.label ? (
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                  {presentation.dot ? (
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", DOT_CLASS_NAME[presentation.dot])}
                    />
                  ) : null}
                  {presentation.label}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              aria-label={`Remove preview ${label}`}
              className="touch-target relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => onRemove(link.url)}
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ThreadPreviewLinkChip({
  link,
  state,
  onOpen,
  onRemove,
}: {
  readonly link: ThreadPreviewLink;
  readonly state: ThreadPreviewLinkState;
  readonly onOpen: OpenLink;
  readonly onRemove: RemoveLink;
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
  const ariaLabel = [`Preview ${label}`, presentation.label].filter(Boolean).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            tone="muted"

            aria-label={ariaLabel}
            onPointerDown={stopRow}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            {...middleClickOpensExternally(link.url, state)}
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
