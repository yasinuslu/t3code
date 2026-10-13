/**
 * What the rail and the board share, so they read as one thing: the header
 * line, the pinned manager row, the card row, stage headers, and the keyboard
 * model of the navigation zone.
 *
 * Two zones: the navigation zone (rail in Threads mode, board in Board mode)
 * and the chat's composer. Focus starts in the navigation zone and stays there
 * while the selection changes; Enter or i moves it into the composer, Esc in
 * the composer brings it back (see GrowWorkspace). Rows are real buttons with
 * a roving tabindex on the selected one.
 */
import { type GrowStage } from "@t3tools/contracts";
import { Columns3Icon, KeyboardIcon, ListIcon, MessagesSquareIcon, PlayIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef } from "react";

import { useManagerProfile } from "../../brainstormStore";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { WORK_REASON_LOOK } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  GROW_MANAGER_KEY,
  GROW_STAGE_DEFS,
  type GrowBoard,
  type GrowBoardCard,
  type GrowDirection,
  growBoardStep,
  growStepSelection,
} from "./grow.logic";
import { type GrowLeftMode, useGrowStore } from "./grow.store";

const ALL_PROJECTS = "all";

/** Threads | Board switch, project filter and keyboard help: one line, same in both modes. */
export function GrowHeader(props: { readonly projects: ReadonlyArray<string> }) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-grow-header="">
      <LeftSwitch />
      <ProjectFilter projects={props.projects} />
      <KeyboardHelp />
    </div>
  );
}

function LeftSwitch() {
  const leftMode = useGrowStore((store) => store.leftMode);
  const setLeftMode = useGrowStore((store) => store.setLeftMode);
  return (
    <ToggleGroup
      aria-label="Left side"
      className="shrink-0"
      value={[leftMode]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "threads" || value === "board") setLeftMode(value);
      }}
    >
      <Toggle value="threads" aria-label="Threads" title="Threads (b)">
        <ListIcon />
      </Toggle>
      <Toggle value="board" aria-label="Board" title="Board (b)">
        <Columns3Icon />
      </Toggle>
    </ToggleGroup>
  );
}

/** One select under the space filter: all projects, or one that has cards. */
function ProjectFilter(props: { readonly projects: ReadonlyArray<string> }) {
  const project = useGrowStore((store) => store.project);
  const setProject = useGrowStore((store) => store.setProject);
  const known = useProjects();
  const titleOf = (key: string) =>
    known.find((candidate) => `${candidate.environmentId}:${candidate.id}` === key)?.title ?? key;
  const items = [
    { value: ALL_PROJECTS, label: "All projects" },
    ...props.projects.map((key) => ({ value: key, label: titleOf(key) })),
  ];
  const value = project !== null && props.projects.includes(project) ? project : ALL_PROJECTS;
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => setProject(next === ALL_PROJECTS ? null : next)}
    >
      <SelectTrigger size="compact" aria-label="Project" className="min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const KEY_HELP: ReadonlyArray<readonly [string, string]> = [
  ["j k  or  Up Down", "Move through the list"],
  ["h l  or  Left Right", "Across board columns"],
  ["Enter, i  or  l", "Type to this thread"],
  ["Esc", "Back here from typing, or close Home"],
  ["b", "Threads or Board"],
  ["m", "Manager, and back"],
  ["p  /  o", "Play / Overview"],
];

function KeyboardHelp() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            className="shrink-0"
          />
        }
      >
        <KeyboardIcon />
      </PopoverTrigger>
      <PopoverPopup align="end">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-xs">
          {KEY_HELP.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-muted-foreground text-xs">
          Keys work while the list has focus. Click a row to bring focus back from the prototype.
        </p>
      </PopoverPopup>
    </Popover>
  );
}

export function useManagerLabel(): string {
  const profile = useManagerProfile();
  return profile === null ? "Manager" : `Manager: ${profile}`;
}

const ROW_BASE =
  "relative flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-foreground";
const rowLook = (selected: boolean, variant: "rail" | "card") =>
  cn(
    ROW_BASE,
    variant === "card" && "border bg-card",
    selected
      ? cn("bg-accent text-accent-foreground", variant === "card" && "border-primary/60")
      : "hover:bg-accent/50",
  );
const ITEM_BUTTON =
  "flex min-w-0 flex-1 flex-col gap-0.5 text-start outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring";

/** The manager as a pinned row, the same row as a card's. */
export function ManagerRow(props: {
  readonly selected: boolean;
  readonly variant?: "rail" | "card";
}) {
  const select = useGrowStore((store) => store.select);
  const label = useManagerLabel();
  return (
    <div
      data-grow-row=""
      data-grow-manager=""
      data-grow-selected={props.selected ? "true" : undefined}
      className={rowLook(props.selected, props.variant ?? "rail")}
    >
      <button
        type="button"
        data-grow-item=""
        tabIndex={props.selected ? 0 : -1}
        aria-current={props.selected ? "true" : undefined}
        className={cn(ITEM_BUTTON, "flex-row items-center gap-2 font-medium")}
        onClick={(event) => {
          select(GROW_MANAGER_KEY);
          event.currentTarget.focus();
        }}
      >
        <MessagesSquareIcon className="size-4 shrink-0 text-icon-muted" />
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

/** Title and one meta line; a Play icon at the end when there is something to play. */
export function GrowRow(props: {
  readonly card: GrowBoardCard;
  readonly selected: boolean;
  readonly variant: "rail" | "card";
  readonly onSelect: (key: string) => void;
  /** Wide windows: Play opens the prototype in Threads mode; otherwise it is a link. */
  readonly onPlay?: (key: string) => void;
}) {
  const { card, onPlay } = props;
  const lessons = card.card?.lessons.length ?? 0;
  const look = WORK_REASON_LOOK[card.reason];
  const playLabel = `Play ${card.thread.title}`;
  return (
    <div
      data-grow-row=""
      data-grow-card={card.thread.id}
      data-grow-rail-row={card.thread.id}
      data-grow-selected={props.selected ? "true" : undefined}
      className={rowLook(props.selected, props.variant)}
    >
      <button
        type="button"
        data-grow-item=""
        tabIndex={props.selected ? 0 : -1}
        aria-current={props.selected ? "true" : undefined}
        className={ITEM_BUTTON}
        onClick={(event) => {
          props.onSelect(card.key);
          event.currentTarget.focus();
        }}
      >
        <span className={cn("font-medium", props.variant === "card" ? "line-clamp-2" : "truncate")}>
          {card.thread.title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", look.dot)} />
          <span className="truncate">{look.label}</span>
          {lessons > 0 ? (
            <span className="shrink-0 tabular-nums">
              {lessons === 1 ? "1 lesson" : `${lessons} lessons`}
            </span>
          ) : null}
          <span className="ms-auto shrink-0 tabular-nums">
            {formatRelativeTimeLabel(card.lastActivityAt)}
          </span>
        </span>
      </button>
      {card.playUrl ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={playLabel}
          title={playLabel}
          className="relative z-10 shrink-0"
          {...(onPlay
            ? { onClick: () => onPlay(card.key) }
            : { render: <a href={card.playUrl} target="_blank" rel="noopener noreferrer" /> })}
        >
          <PlayIcon />
        </Button>
      ) : null}
    </div>
  );
}

/** Stage title and count; your-turn stages are warm. The same in the rail and on the board. */
export function StageHeader(props: { readonly stage: GrowStage; readonly count: number }) {
  const def = GROW_STAGE_DEFS[props.stage];
  return (
    <h2 className="flex items-baseline gap-2 px-1 font-medium text-xs">
      <span className={def.yourTurn ? "text-warning-foreground" : undefined}>{def.title}</span>
      <span className="text-muted-foreground tabular-nums">{props.count}</span>
    </h2>
  );
}

/** Stand-in for the groups until the board has loaded; static, nothing repaints. */
export function GrowNavSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-1" data-grow-skeleton="">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-9 rounded-md bg-muted/60" />
      ))}
    </div>
  );
}

const composerEditor = () =>
  document.querySelector<HTMLElement>('[data-grow-chat] [data-testid="composer-editor"]');

/** Moves focus to the zone's selected row. */
export function focusSelectedRow(zone: HTMLElement | null) {
  zone
    ?.querySelector<HTMLElement>('[data-grow-item][tabindex="0"]')
    ?.focus({ preventScroll: true });
  zone
    ?.querySelector('[data-grow-item][tabindex="0"]')
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The zone's keys. Attach `onKeyDown` and `ref` to the zone element; the
 * handler acts when focus is on one of its rows (or the zone itself), and a
 * window listener covers focus resting on the page body. Focus follows the
 * selection, so changing it never moves focus into the chat.
 */
export function useGrowNav<T extends HTMLElement>(options: {
  readonly mode: GrowLeftMode;
  readonly board: GrowBoard;
  readonly selected: string;
  readonly canPlay: boolean;
  /** False below lg, where the board only opens a dialog. */
  readonly enabled?: boolean;
}): {
  readonly ref: RefObject<T | null>;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
} {
  const ref = useRef<T | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // Focus is in the zone when Grow opens or the mode switches. Anything that grabs it later
  // while this mounts (a composer, the page underneath) loses it back, until the user acts.
  useEffect(() => {
    const zone = ref.current;
    let interacted = false;
    const interact = () => {
      interacted = true;
    };
    window.addEventListener("pointerdown", interact, true);
    window.addEventListener("keydown", interact, true);
    const take = () => {
      if (interacted || zone === null || zone.contains(document.activeElement)) return;
      focusSelectedRow(zone);
    };
    focusSelectedRow(zone);
    const frame = window.requestAnimationFrame(take);
    const timers = [100, 400, 1200].map((delay) => window.setTimeout(take, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", interact, true);
      window.removeEventListener("keydown", interact, true);
    };
  }, []);
  const { selected } = options;
  useEffect(() => {
    const zone = ref.current;
    if (zone?.contains(document.activeElement)) focusSelectedRow(zone);
    else
      zone
        ?.querySelector('[data-grow-item][tabindex="0"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const handle = useCallback((event: KeyboardEvent, onRow: boolean): boolean => {
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    const { mode, board, selected, canPlay, enabled = true } = latest.current;
    if (!enabled) return false;
    const store = useGrowStore.getState();
    const onCard = selected !== GROW_MANAGER_KEY;
    const used = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    const direction: GrowDirection | null =
      event.key === "j" || event.key === "ArrowDown"
        ? "down"
        : event.key === "k" || event.key === "ArrowUp"
          ? "up"
          : event.key === "h" || event.key === "ArrowLeft"
            ? "left"
            : event.key === "l" || event.key === "ArrowRight"
              ? "right"
              : null;
    if (direction !== null) {
      // Right keeps going into the chat: at once in the rail, past the last column on the board.
      const intoChat = () => {
        const editor = composerEditor();
        if (!editor) return false;
        editor.focus();
        return used();
      };
      if (mode === "board") {
        const next = growBoardStep(board, selected, direction);
        if (direction === "right" && next === selected) return intoChat();
        store.select(next);
        return used();
      }
      if (direction === "right") return intoChat();
      if (direction === "left") return false;
      store.select(growStepSelection(board, selected, direction === "down" ? 1 : -1));
      return used();
    }
    switch (event.key) {
      case "Enter":
      case "i": {
        if (!onRow) return false;
        const editor = composerEditor();
        if (!editor) return false;
        editor.focus();
        return used();
      }
      case "b":
        store.setLeftMode(mode === "threads" ? "board" : "threads");
        return used();
      case "m":
        store.toggleManager();
        return used();
      case "p":
        if (!onCard || !canPlay) return false;
        store.setThingTab("play");
        store.setLeftMode("threads");
        return used();
      case "o":
        if (!onCard) return false;
        store.setThingTab("overview");
        store.setLeftMode("threads");
        return used();
      default:
        return false;
    }
  }, []);

  // Focus on the body (after a click on nothing, or a closed popup) still reaches the keys.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== document.body) return;
      if (handle(event, false)) focusSelectedRow(ref.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handle]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-grow-row]") == null && target !== event.currentTarget) return;
      handle(event.nativeEvent, target?.closest("[data-grow-item]") != null);
    },
    [handle],
  );
  return { ref, onKeyDown };
}
