/**
 * The pieces of Grow's Threads mode: the switch between Threads and Board, the
 * rail of every card with the manager pinned above it, and the selected
 * thread as a "thing" to play with and understand. Switching is instant; only
 * the selected thread's prototype is mounted.
 */
import { GROW_STAGES } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, MessagesSquareIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useManagerProfile } from "../../brainstormStore";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  ThreadReportBody,
  ThreadReportLinks,
  WORK_REASON_LOOK,
  useThreadReport,
} from "../home/ThreadReportCard";
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
import { SavedField, StageActions, type UpdateCard } from "./GrowParts";

/** Same place and size in both left-side modes, so it never jumps. */
export function LeftSwitch() {
  const leftMode = useGrowStore((store) => store.leftMode);
  const setLeftMode = useGrowStore((store) => store.setLeftMode);
  return (
    <ToggleGroup
      aria-label="Left side"
      className="self-start"
      value={[leftMode]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "threads" || value === "board") setLeftMode(value);
      }}
    >
      <Toggle value="threads">Threads</Toggle>
      <Toggle value="board">Board</Toggle>
    </ToggleGroup>
  );
}

export function useManagerLabel(): string {
  const profile = useManagerProfile();
  return profile === null ? "Manager" : `Manager: ${profile}`;
}

/** Selects the manager; highlighted while selected. */
export function ManagerButton(props: { readonly selected: boolean }) {
  const select = useGrowStore((store) => store.select);
  const label = useManagerLabel();
  return (
    <Button
      size="sm"
      variant={props.selected ? "default" : "outline"}
      aria-pressed={props.selected}
      aria-current={props.selected ? "true" : undefined}
      data-grow-manager=""
      className="self-start"
      onClick={() => select(GROW_MANAGER_KEY)}
    >
      <MessagesSquareIcon />
      {label}
    </Button>
  );
}

export function Rail(props: { readonly board: GrowBoard; readonly selected: string }) {
  const select = useGrowStore((store) => store.select);
  const rail = useRef<HTMLElement>(null);
  const { selected } = props;
  useEffect(() => {
    rail.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <nav
      ref={rail}
      aria-label="Cards"
      className="flex min-h-0 w-68 flex-col gap-2 border-e pe-2 pb-3"
    >
      <LeftSwitch />
      <ManagerButton selected={selected === GROW_MANAGER_KEY} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {GROW_STAGES.map((stage) => {
          const cards = props.board[stage];
          if (cards.length === 0) return null;
          const def = GROW_STAGE_DEFS[stage];
          return (
            <section key={stage} aria-label={def.title} className="flex flex-col gap-0.5">
              <h2 className="flex items-baseline gap-2 px-1 font-medium text-xs">
                <span className={def.yourTurn ? "text-warning-foreground" : undefined}>
                  {def.title}
                </span>
                <span className="text-muted-foreground tabular-nums">{cards.length}</span>
              </h2>
              {cards.map((card) => (
                <RailRow
                  key={card.key}
                  card={card}
                  focused={card.key === selected}
                  onFocus={() => select(card.key)}
                />
              ))}
            </section>
          );
        })}
      </div>
      <p className="px-1 text-muted-foreground text-xs">
        j/k threads · m manager · b board · p play · o overview · Esc board. Click outside the
        prototype first.
      </p>
    </nav>
  );
}

function RailRow(props: {
  readonly card: GrowBoardCard;
  readonly focused: boolean;
  readonly onFocus: () => void;
}) {
  const { card } = props;
  const lessons = card.card?.lessons.length ?? 0;
  return (
    <button
      type="button"
      aria-current={props.focused ? "true" : undefined}
      data-grow-rail-row={card.thread.id}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.focused ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
      onClick={props.onFocus}
    >
      <span className="truncate font-medium">{card.thread.title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {card.stage === "play" ? (
          <Badge variant="default" size="sm">
            Play
          </Badge>
        ) : card.reason !== "settled" ? (
          <span className="flex min-w-0 items-center gap-1">
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", WORK_REASON_LOOK[card.reason].dot)}
            />
            <span className="truncate">{WORK_REASON_LOOK[card.reason].label}</span>
          </span>
        ) : null}
        {lessons > 0 ? (
          <span className="ms-auto shrink-0 tabular-nums">
            {lessons === 1 ? "1 lesson" : `${lessons} lessons`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

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
      className="flex min-h-0 min-w-0 flex-col gap-2 border-s ps-3 pb-3"
      data-grow-thing={thread.id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate font-semibold text-base">{thread.title}</h2>
        <Badge variant="outline" size="sm">
          {GROW_STAGE_DEFS[card.stage].title}
        </Badge>
        <span className="ms-auto flex items-center gap-1">
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
        className="min-h-0 flex-1 rounded-lg border bg-background"
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
        value={stored?.became ?? ""}
        onSave={(value) => update(card, { became: value.trim() })}
      />
      <SavedField
        label="Lessons, one per line"
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
