/**
 * The pieces of Grow's Threads mode: the rail of every card with the manager
 * pinned above it, and the selected thread as a "thing" to play with and
 * understand. Switching is instant; only the selected thread's prototype is
 * mounted.
 *
 * The played thing can be anything the owner can open: a running app, or an
 * HTML page that shows the work (a report, demo or pitch, with video,
 * screenshots or a recording). Everything here treats it as a page in an
 * iframe, nothing more.
 */
import { GROW_STAGES } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, MessagesSquareIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ThreadReportBody, ThreadReportLinks, useThreadReport } from "../home/ThreadReportCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  GROW_MANAGER_KEY,
  GROW_STAGE_DEFS,
  type GrowBoard,
  type GrowBoardCard,
} from "./grow.logic";
import { type GrowThingTab, useGrowStore } from "./grow.store";
import {
  GrowHeader,
  type GrowSearch,
  GrowNavSkeleton,
  GrowRow,
  ManagerRow,
  NoMatches,
  StageHeader,
  useGrowNav,
} from "./GrowNav";
import { SavedField, StageActions, type UpdateCard } from "./GrowParts";

export function Rail(props: {
  readonly board: GrowBoard;
  readonly selected: string;
  readonly projects: ReadonlyArray<string>;
  readonly search: GrowSearch;
  readonly ready: boolean;
  readonly canPlay: boolean;
}) {
  const select = useGrowStore((store) => store.select);
  const play = useGrowStore((store) => store.play);
  const nav = useGrowNav<HTMLElement>({
    mode: "threads",
    board: props.board,
    selected: props.selected,
    canPlay: props.canPlay,
    ready: props.ready,
  });
  return (
    <nav
      ref={nav.ref}
      onKeyDown={nav.onKeyDown}
      aria-label="Cards"
      data-grow-zone=""
      className="flex min-h-0 w-full flex-1 flex-col gap-2 border-e pe-2 pb-3"
    >
      <GrowHeader projects={props.projects} search={props.search} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {/* Opaque, so rows scrolling under the manager do not show through. */}
        <div className="sticky top-0 z-20 border-b bg-background pb-1">
          <ManagerRow selected={props.selected === GROW_MANAGER_KEY} />
        </div>
        {!props.ready ? (
          <GrowNavSkeleton />
        ) : GROW_STAGES.every((stage) => props.board[stage].length === 0) ? (
          props.search.query.trim() === "" ? (
            <p className="px-1 text-muted-foreground text-xs">Nothing here yet</p>
          ) : (
            <NoMatches />
          )
        ) : (
          GROW_STAGES.map((stage) => {
            const cards = props.board[stage];
            if (cards.length === 0) return null;
            return (
              <section
                key={stage}
                aria-label={GROW_STAGE_DEFS[stage].title}
                className="flex flex-col gap-0.5"
              >
                <StageHeader stage={stage} count={cards.length} />
                {cards.map((card) => (
                  <GrowRow
                    key={card.key}
                    card={card}
                    variant="rail"
                    selected={card.key === props.selected}
                    onSelect={select}
                    onPlay={play}
                  />
                ))}
              </section>
            );
          })
        )}
      </div>
    </nav>
  );
}

/** The selected thread's playable (any page the owner can open) and its overview. */
export function Thing(props: { readonly card: GrowBoardCard; readonly update: UpdateCard }) {
  const { card, update } = props;
  const { thread } = card;
  const links = thread.previewLinks ?? [];
  const playable = links.length > 0;
  const chosen = useGrowStore((store) => store.thingTab);
  const setCenterTab = useGrowStore((store) => store.setThingTab);
  const tab: GrowThingTab = playable && (chosen ?? "play") === "play" ? "play" : "overview";
  return (
    <section
      aria-label={thread.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border-s px-3 pt-3 pb-3"
      data-grow-thing={thread.id}
    >
      <h2 className="line-clamp-2 min-w-0 font-semibold text-base">{thread.title}</h2>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" size="sm">
          {GROW_STAGE_DEFS[card.stage].title}
        </Badge>
        <span className="ms-auto flex shrink-0 items-center gap-1">
          {card.playUrl ? (
            <Button
              size="xs"
              render={<a href={card.playUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <PlayIcon />
              Play
            </Button>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Open the full thread page"
            title="Open the full thread page"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.id }}
              />
            }
          >
            <MessagesSquareIcon />
          </Button>
        </span>
      </div>
      <StageActions card={card} update={update} />
      <ToggleGroup
        aria-label="Center view"
        className="self-start"
        value={[tab]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "play" || value === "overview") setCenterTab(value);
        }}
      >
        <Toggle value="play" disabled={!playable}>
          Play
        </Toggle>
        <Toggle value="overview">Overview</Toggle>
      </ToggleGroup>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "play" ? (
          <PlayPane key={card.key} links={links} />
        ) : (
          <Overview card={card} update={update} />
        )}
      </div>
    </section>
  );
}

function PlayPane(props: { readonly links: NonNullable<GrowBoardCard["thread"]["previewLinks"]> }) {
  const [index, setIndex] = useState(0);
  const [reload, setReload] = useState(0);
  const link = props.links[index] ?? props.links[0];
  if (!link) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {props.links.length > 1 ? (
          <Select value={String(index)} onValueChange={(value) => setIndex(Number(value) || 0)}>
            <SelectTrigger size="compact" aria-label="Preview" className="max-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {props.links.map((candidate, position) => (
                <SelectItem key={candidate.url} value={String(position)}>
                  {candidate.label ?? candidate.url}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{link.url}</span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Reload"
          title="Reload"
          onClick={() => setReload((count) => count + 1)}
        >
          <RotateCwIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Open in new tab"
          title="Open in new tab"
          render={<a href={link.url} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
        </Button>
      </div>
      <iframe
        key={`${link.url}:${reload}`}
        src={link.url}
        title="Prototype"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads"
        allow="fullscreen; clipboard-read; clipboard-write; autoplay; gamepad"
        className="min-h-0 flex-1 rounded-lg border bg-background in-data-[grow-resizing]:pointer-events-none"
      />
    </div>
  );
}

function Overview(props: { readonly card: GrowBoardCard; readonly update: UpdateCard }) {
  const { card, update } = props;
  const { thread } = card;
  const { digest, pullRequests } = useThreadReport(thread);
  const stored = card.card;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pe-2">
      <SavedField
        label="What it became"
        placeholder="Not written yet. What did this idea turn into?"
        value={stored?.became ?? ""}
        onSave={(value) => update(card, { became: value.trim() })}
      />
      <SavedField
        label="Lessons, one per line"
        placeholder="What did you learn? One lesson per line."
        value={(stored?.lessons ?? []).join("\n")}
        onSave={(value) =>
          update(card, {
            lessons: value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          })
        }
      />
      <ThreadReportBody environmentId={thread.environmentId} threadId={thread.id} digest={digest} />
      <ThreadReportLinks tryUrls={[]} pullRequests={pullRequests} />
      <p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        {thread.branch ? <span className="font-mono">{thread.branch}</span> : null}
        <span>Last activity {formatRelativeTimeLabel(card.lastActivityAt)}</span>
      </p>
    </div>
  );
}
