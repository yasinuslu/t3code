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
import {
  ChevronsUpDownIcon,
  Columns3Icon,
  KeyboardIcon,
  ListIcon,
  MessagesSquareIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef } from "react";

import { useManagerProfile } from "../../brainstormStore";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { WORK_REASON_LOOK } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
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

/** The search text, owned by the workspace; `firstKey` is the first card still shown. */
export interface GrowSearch {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly firstKey: string | null;
}

/**
 * Same in both modes: Threads | Board switch, project filter and keyboard help
 * on one line, the search field under it.
 */
export function GrowHeader(props: {
  readonly projects: ReadonlyArray<string>;
  readonly search: GrowSearch;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-grow-header="">
      <div className="flex min-w-0 items-center gap-2">
        <LeftSwitch />
        <ProjectFilter projects={props.projects} />
        <KeyboardHelp />
      </div>
      <SearchField search={props.search} />
    </div>
  );
}

/**
 * Filters the list by title and what a card became. `/` in the list focuses
 * it; Esc leaves it for the list (GrowWorkspace); Enter or Down selects the
 * first match and goes to the list.
 */
function SearchField(props: { readonly search: GrowSearch }) {
  const { query, setQuery, firstKey } = props.search;
  const select = useGrowStore((store) => store.select);
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        nativeInput
        type="text"
        size="sm"
        data-grow-search=""
        aria-label="Search threads"
        placeholder="Search threads  /"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "ArrowDown") return;
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (firstKey !== null) select(firstKey);
          const zone = event.currentTarget.closest<HTMLElement>("[data-grow-zone]");
          window.requestAnimationFrame(() => focusSelectedRow(zone));
        }}
      />
      {query === "" ? null : (
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Clear search"
            onClick={(event) => {
              setQuery("");
              event.currentTarget
                .closest("[data-grow-header]")
                ?.querySelector<HTMLElement>("[data-grow-search]")
                ?.focus();
            }}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      )}
    </InputGroup>
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
      <Toggle value="threads" aria-label="Threads" title="Threads (o)">
        <ListIcon />
      </Toggle>
      <Toggle value="board" aria-label="Board" title="Board (i)">
        <Columns3Icon />
      </Toggle>
    </ToggleGroup>
  );
}

/** Searchable project filter: all projects, or one that has cards. */
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
  const current = items.find((item) => item.value === value) ?? items[0];
  return (
    <Combobox
      items={items}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      value={current}
      onValueChange={(item) => {
        if (item) setProject(item.value === ALL_PROJECTS ? null : item.value);
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-label="Project"
            className="min-w-0 flex-1 justify-between"
          />
        }
      >
        <span className="truncate">{current?.label}</span>
        <ChevronsUpDownIcon className="opacity-60" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput aria-label="Search projects" placeholder="Search projects..." />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof items)[number]) => (
            <ComboboxItem key={item.value} value={item} hideIndicator>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

const KEY_HELP: ReadonlyArray<readonly [string, string]> = [
  ["j k  or  Up Down", "Move through the list"],
  ["h l  or  Left Right", "Across board columns"],
  ["Ctrl+h  /  Ctrl+l", "Pane to the left / right: list, chat, prototype"],
  ["Enter", "Type to this thread"],
  ["/", "Search the list (Enter picks the first match)"],
  ["Esc", "Back to the list from anywhere, or close Home"],
  ["i", "Board"],
  ["o", "Threads list"],
  ["m", "Manager, and back"],
  ["p", "Play this thread's prototype"],
  ["h  /  l", "Play / Overview, in the prototype pane"],
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
  "flex min-w-0 flex-1 flex-col gap-0.5 text-start outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

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
  // The project says where the idea lives; the dot alone carries the thread's state.
  const project = useProjects().find(
    (candidate) =>
      candidate.environmentId === card.thread.environmentId &&
      candidate.id === card.thread.projectId,
  )?.title;
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
        <span className="line-clamp-2 font-medium">{card.thread.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <span
            aria-label={look.label}
            title={look.label}
            role="img"
            className={cn("size-1.5 shrink-0 rounded-full", look.dot)}
          />
          <span className="truncate">{project ?? look.label}</span>
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

export const composerEditor = () =>
  document.querySelector<HTMLElement>('[data-grow-chat] [data-testid="composer-editor"]');

/** Moves focus to the zone's selected row. */
export function focusSelectedRow(zone: HTMLElement | null) {
  // The selected row can be filtered out by the search; then the first row takes focus.
  const row =
    zone?.querySelector<HTMLElement>('[data-grow-item][tabindex="0"]') ??
    zone?.querySelector<HTMLElement>("[data-grow-item]");
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
      if (mode === "board") {
        store.select(growBoardStep(board, selected, direction));
        return used();
      }
      if (direction === "left" || direction === "right") return false;
      store.select(growStepSelection(board, selected, direction === "down" ? 1 : -1));
      return used();
    }
    switch (event.key) {
      case "Enter": {
        if (!onRow) return false;
        const editor = composerEditor();
        if (!editor) return false;
        editor.focus();
        return used();
      }
      case "i":
        store.setLeftMode("board");
        return used();
      case "o":
        store.setLeftMode("threads");
        return used();
      case "/": {
        const search = ref.current?.querySelector<HTMLElement>("[data-grow-search]");
        if (!search) return false;
        search.focus();
        return used();
      }
      case "m":
        store.toggleManager();
        return used();
      case "p":
        if (!onCard || !canPlay) return false;
        store.setThingTab("play");
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
      if (handle(event, false) && event.key !== "/") focusSelectedRow(ref.current);
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
