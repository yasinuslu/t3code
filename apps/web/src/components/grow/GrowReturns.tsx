/**
 * Grow: what the agents made comes back here, one thing at a time. The hero
 * shows it (its screenshot, or the live preview behind Play), what it asks,
 * and three choices: the main one (Reply to its question, Ship work that can
 * land, or Done for what has nothing to merge), What if, Let go. The list
 * beside it is the rest of the queue by project, then what is done and what
 * was let go. On a phone the
 * hero takes the screen and the list is one tap away.
 *
 * Nothing here needs agents to fill in extra fields: everything is read off
 * the thread (previews, pull requests, status report, run state). The only
 * thing recorded is the decision, in the thread's grow card.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { GrowDecision } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ListIcon,
  MessageSquareIcon,
  PlayIcon,
  ReplyIcon,
  RocketIcon,
  SearchIcon,
  SparklesIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { useEveryManagerThreadKey } from "../../brainstormStore";
import { closeHomeOverlay } from "../../homeOverlayStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn, newMessageId } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { growEnvironment, useGrowCards, useGrowLoaded } from "../../state/grow";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { WORK_REASON_LOOK, useReportImages, useThreadReport } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { decide, undo, usePendingDecisions } from "./grow.decide";
import { GrowPreview } from "./GrowPreview";
import {
  type GrowDeck,
  type GrowReturn,
  SHIP_MESSAGE,
  buildGrowDeck,
  filterGrowDeck,
  growCurrent,
  cleanLabel,
  growNextAfter,
  growPrimary,
  growProjectKey,
  growQueue,
  growSpark,
  growStep,
} from "./returns.logic";

/** Where the deck is, kept while Home is closed: the shown item, the phone's view, the search. */
const useReturnsStore = create<{
  readonly selected: string | null;
  readonly phoneView: "card" | "list";
  readonly query: string;
  readonly playing: string | null;
}>(() => ({ selected: null, phoneView: "card", query: "", playing: null }));

const select = (key: string | null) =>
  useReturnsStore.setState({ selected: key, phoneView: "card", playing: null });

/** The actions on a return, wired to the thread and its grow card. */
function useReturnActions(moveOn: (item: GrowReturn) => void) {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const update = useAtomCommand(growEnvironment.update);
  const navigate = useNavigate();

  const record = (item: GrowReturn, decision: GrowDecision | null) =>
    update({
      environmentId: item.thread.environmentId,
      input: { threadId: item.thread.id, decision },
    });

  const send = async (item: GrowReturn, text: string) => {
    const result = await startTurn({
      environmentId: item.thread.environmentId,
      input: {
        threadId: item.thread.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: item.thread.runtimeMode,
        interactionMode: item.thread.interactionMode,
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: `Could not reach ${item.headline}` });
      return false;
    }
    return true;
  };

  return {
    ship: (item: GrowReturn) => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Shipping ${item.headline}`,
        run: async () => {
          // Recorded after the message, so the decision outlives the message (see heldDecision).
          if (await send(item, SHIP_MESSAGE)) await record(item, "adopt");
        },
      });
    },
    whatIf: (item: GrowReturn, text: string) => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Sending to ${item.headline}`,
        run: async () => {
          if ((await send(item, text)) && item.card?.decision !== undefined) {
            await record(item, null);
          }
        },
      });
    },
    done: (item: GrowReturn) => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Done: ${item.headline}`,
        run: async () => {
          await record(item, "adopt");
        },
      });
    },
    letGo: (item: GrowReturn) => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Let go of ${item.headline}`,
        run: async () => {
          await record(item, "shelve");
        },
      });
    },
    bringBack: (item: GrowReturn) => void record(item, null),
    openThread: (item: GrowReturn) => {
      closeHomeOverlay();
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: item.thread.environmentId, threadId: item.thread.id },
      });
    },
  };
}

type ReturnActions = ReturnType<typeof useReturnActions>;

function useProjectTitle() {
  const projects = useProjects();
  return useMemo(() => {
    const titles = new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
    );
    return (thread: EnvironmentThreadShell) => titles.get(growProjectKey(thread)) ?? "No project";
  }, [projects]);
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role=dialog]") !== null);

export function GrowReturns(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
}) {
  const cards = useGrowCards();
  const loaded = useGrowLoaded();
  const managers = useEveryManagerThreadKey();
  const pending = usePendingDecisions((state) => state.keys);
  const { selected, phoneView, query, playing } = useReturnsStore();
  const wide = useMediaQuery("md");
  const [whatIfOpen, setWhatIfOpen] = useState(false);

  const deck = useMemo(
    () => buildGrowDeck(props.threads, cards, props.now, { excluded: managers.keys, pending }),
    [cards, managers.keys, pending, props.now, props.threads],
  );
  const shown = useMemo(() => filterGrowDeck(deck, query), [deck, query]);
  const actions = useReturnActions((item) => select(growNextAfter(shown, item.key)));
  const current = growCurrent(shown, selected);
  const queue = growQueue(shown);
  const spark = queue.length === 0 && query === "" ? growSpark(deck) : null;
  const ready = loaded && managers.known;

  // Changing what shows closes the What if field.
  const currentKey = current?.key ?? null;
  const [whatIfFor, setWhatIfFor] = useState(currentKey);
  if (whatIfFor !== currentKey) {
    setWhatIfFor(currentKey);
    setWhatIfOpen(false);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (isTyping(event.target)) return;
      const item = current;
      const step = (direction: 1 | -1) => select(growStep(shown, item?.key ?? null, direction));
      const used = () => event.preventDefault();
      switch (event.key) {
        case "j":
        case "ArrowDown":
          step(1);
          return used();
        case "k":
        case "ArrowUp":
          step(-1);
          return used();
        case "u":
          if (undo()) used();
          return;
        case "/":
          document.querySelector<HTMLElement>("[data-grow-search]")?.focus();
          return used();
      }
      if (item === null) return;
      const open = item.kind === "return" || item.kind === "urgent";
      if (event.key === "s" && item.kind === "return" && item.shippable) {
        actions.ship(item);
        used();
      } else if (event.key === "d" && item.kind === "return") {
        actions.done(item);
        used();
      } else if ((event.key === "w" || event.key === "r") && open) {
        setWhatIfOpen(true);
        used();
      } else if (event.key === "l" && open) {
        actions.letGo(item);
        used();
      } else if (event.key === "o") {
        actions.openThread(item);
        used();
      } else if ((event.key === "p" || event.key === "Enter") && item.playUrl !== null) {
        if (wide && isPreviewSupportedInRuntime())
          useReturnsStore.setState({ playing: playing === item.key ? null : item.key });
        else window.open(item.playUrl, "_blank", "noopener");
        used();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, current, playing, shown, wide]);

  if (!ready) return <ReturnsSkeleton />;

  const header = (
    <ReturnsHeader
      today={deck.urgent.length + deck.returns.length}
      working={deck.working}
      query={query}
      phoneList={
        !wide && phoneView === "card" ? () => useReturnsStore.setState({ phoneView: "list" }) : null
      }
    />
  );
  const hero = current ? (
    <Hero
      key={current.key}
      item={current}
      actions={actions}
      wide={wide}
      playing={playing === current.key}
      whatIfOpen={whatIfOpen}
      setWhatIfOpen={setWhatIfOpen}
      position={positionOf(shown, current)}
      step={(direction) => select(growStep(shown, current.key, direction))}
    />
  ) : (
    <CaughtUp spark={spark} actions={actions} searching={query !== ""} />
  );

  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-grow-returns="phone">
        {phoneView === "list" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => useReturnsStore.setState({ phoneView: "card" })}
              >
                <ArrowLeftIcon />
                Back
              </Button>
            </div>
            <div className="px-3 pb-2">{header}</div>
            <ReturnsList deck={shown} current={currentKey} />
          </div>
        ) : (
          <>
            <div className="px-3 pt-2">{header}</div>
            {hero}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
      data-grow-returns="wide"
    >
      <div className="flex min-h-0 flex-col border-e ps-(--workspace-gutter-start) pe-3 pt-3">
        {header}
        <ReturnsList deck={shown} current={currentKey} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">{hero}</div>
    </div>
  );
}

/** Where the item sits among today's returns, or among the earlier ones once past them. */
function positionOf(deck: GrowDeck, item: GrowReturn) {
  for (const section of [[...deck.urgent, ...deck.returns], deck.older]) {
    const index = section.findIndex((candidate) => candidate.key === item.key);
    if (index >= 0) return { index, total: section.length };
  }
  return null;
}

function ReturnsHeader(props: {
  readonly today: number;
  readonly working: number;
  readonly query: string;
  readonly phoneList: (() => void) | null;
}) {
  return (
    <div className="flex flex-col gap-2 pb-3">
      <div className="flex items-baseline gap-2">
        <h1 className="font-semibold text-lg">
          {props.today === 0 ? "Nothing today" : `${props.today} today`}
        </h1>
        {props.working > 0 ? (
          <span className="truncate text-muted-foreground text-xs">{props.working} working</span>
        ) : null}
        {props.phoneList ? (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={props.phoneList}
            aria-label="All returns"
          >
            <ListIcon />
            All
          </Button>
        ) : null}
      </div>
      {props.phoneList ? null : (
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            nativeInput
            type="text"
            size="sm"
            data-grow-search=""
            aria-label="Search"
            placeholder="Search  /"
            value={props.query}
            onChange={(event) => useReturnsStore.setState({ query: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          {props.query === "" ? null : (
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Clear search"
                onClick={() => useReturnsStore.setState({ query: "" })}
              >
                <XIcon />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      )}
    </div>
  );
}

/** The queue by project, then the older ones, what shipped and what was let go (folded). */
function ReturnsList(props: { readonly deck: GrowDeck; readonly current: string | null }) {
  const { deck } = props;
  const projectTitle = useProjectTitle();
  const groups = useMemo(() => {
    const byProject = new Map<string, { title: string; items: GrowReturn[] }>();
    for (const item of deck.returns) {
      const key = growProjectKey(item.thread);
      const group = byProject.get(key);
      if (group) group.items.push(item);
      else byProject.set(key, { title: projectTitle(item.thread), items: [item] });
    }
    return [...byProject.entries()];
  }, [deck.returns, projectTitle]);
  const row = (item: GrowReturn) => (
    <ReturnRow key={item.key} item={item} current={item.key === props.current} />
  );
  return (
    <nav aria-label="Returns" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-6">
      {deck.urgent.length > 0 ? (
        <ListSection title="Needs you now" tone="warning">
          {deck.urgent.map(row)}
        </ListSection>
      ) : null}
      {groups.map(([key, group]) => (
        <ListSection key={key} title={group.title}>
          {group.items.map(row)}
        </ListSection>
      ))}
      {deck.older.length > 0 ? (
        <ListSection title={`Earlier (${deck.older.length})`} folded>
          {deck.older.map(row)}
        </ListSection>
      ) : null}
      {deck.shipped.length > 0 ? (
        <ListSection title={`Done this week (${deck.shipped.length})`} folded>
          {deck.shipped.map(row)}
        </ListSection>
      ) : null}
      {deck.letGo.length > 0 ? (
        <ListSection title={`Let go (${deck.letGo.length})`} folded>
          {deck.letGo.map(row)}
        </ListSection>
      ) : null}
    </nav>
  );
}

function ListSection(props: {
  readonly title: string;
  readonly tone?: "warning";
  readonly folded?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(!props.folded);
  return (
    <section className="pt-3">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded px-1 pb-1 text-start font-medium text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
          props.tone === "warning" && "text-warning-foreground",
        )}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {props.title}
      </button>
      {open ? <ul className="flex flex-col gap-0.5">{props.children}</ul> : null}
    </section>
  );
}

function ReturnRow(props: { readonly item: GrowReturn; readonly current: boolean }) {
  const { item } = props;
  return (
    <li>
      <button
        type="button"
        aria-current={props.current ? "true" : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          props.current && "bg-accent font-medium",
        )}
        onClick={() => select(item.key)}
      >
        <RowMark item={item} />
        <span className="min-w-0 flex-1 truncate">{item.headline}</span>
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {formatRelativeTimeLabel(item.lastActivityAt).replace(" ago", "")}
        </span>
      </button>
    </li>
  );
}

function RowMark(props: { readonly item: GrowReturn }) {
  const { item } = props;
  if (item.kind === "shipped") {
    if (item.merged) {
      return (
        <PullRequestGlyph.merged aria-label="Merged" className="size-3.5 shrink-0 text-success" />
      );
    }
    return item.shippable ? (
      <RocketIcon aria-label="Shipping" className="size-3.5 shrink-0 text-info" />
    ) : (
      <CheckIcon aria-label="Done" className="size-3.5 shrink-0 text-success" />
    );
  }
  if (item.kind === "urgent") {
    const look = item.reason ? WORK_REASON_LOOK[item.reason] : null;
    return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", look?.dot)} />;
  }
  if (item.playUrl !== null) {
    return <PlayIcon aria-label="Playable" className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <span aria-hidden className="size-3.5 shrink-0" />;
}

/** One return, big: what it is, what it asks, and the choices. */
function Hero(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly wide: boolean;
  readonly playing: boolean;
  readonly whatIfOpen: boolean;
  readonly setWhatIfOpen: (open: boolean) => void;
  readonly position: { readonly index: number; readonly total: number } | null;
  readonly step: (direction: 1 | -1) => void;
}) {
  const { item, actions, wide } = props;
  const { digest } = useThreadReport(item.thread);
  const projectTitle = useProjectTitle();
  const question = digest.questions[0] ?? null;
  const reason = item.kind === "urgent" && item.reason ? WORK_REASON_LOOK[item.reason] : null;

  return (
    <article
      aria-label={item.headline}
      className={cn("flex min-h-0 flex-1 flex-col", wide ? "overflow-y-auto" : "")}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-4xl flex-col gap-4",
          wide ? "p-6" : "min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4",
        )}
      >
        <Visual item={item} wide={wide} playing={props.playing} screenshots={digest.screenshots} />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span>{projectTitle(item.thread)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTimeLabel(item.lastActivityAt)}</span>
            {item.pullRequest ? (
              <a
                href={item.pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {item.pullRequest.state === "merged" ? (
                  <PullRequestGlyph.merged className="size-3.5" />
                ) : (
                  <PullRequestGlyph.pullRequest className="size-3.5" />
                )}
                PR #{item.pullRequest.number}
                {item.pullRequest.state ? ` ${item.pullRequest.state}` : ""}
              </a>
            ) : null}
            {props.position && wide ? (
              <span className="ms-auto tabular-nums">
                {props.position.index + 1} of {props.position.total}
              </span>
            ) : null}
          </div>
          <h2 className="font-semibold text-2xl leading-tight">{item.headline}</h2>
          {item.headline !== cleanLabel(item.thread.title) ? (
            <p className="truncate text-muted-foreground text-sm">
              {cleanLabel(item.thread.title)}
            </p>
          ) : null}
        </div>
        {reason ? (
          <p className="flex items-center gap-2 font-medium text-sm">
            <span aria-hidden className={cn("size-2 rounded-full", reason.dot)} />
            {reason.label}
          </p>
        ) : null}
        {question ? (
          <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm">
            <span className="font-medium">Asks: </span>
            <WithLinks text={question} />
          </div>
        ) : digest.summary ? (
          <p className="line-clamp-3 text-muted-foreground text-sm">
            <WithLinks text={digest.summary} />
          </p>
        ) : null}
        {wide ? (
          <Choices
            item={item}
            actions={actions}
            question={question !== null}
            whatIfOpen={props.whatIfOpen}
            setWhatIfOpen={props.setWhatIfOpen}
            wide
          />
        ) : null}
      </div>
      {wide ? null : (
        <div className="shrink-0 border-t bg-background px-3 pt-2 pb-3">
          <PhoneStepper position={props.position} step={props.step} />
          <Choices
            item={item}
            actions={actions}
            question={question !== null}
            whatIfOpen={props.whatIfOpen}
            setWhatIfOpen={props.setWhatIfOpen}
            wide={false}
          />
        </div>
      )}
    </article>
  );
}

/** Agent text with its URLs shown as short host links instead of a wall of characters. */
function WithLinks(props: { readonly text: string }) {
  let offset = 0;
  return props.text.split(/(https?:\/\/\S+)/g).map((part) => {
    const at = offset;
    offset += part.length;
    if (!/^https?:\/\//.test(part)) return part;
    const url = part.replace(/[.,;:!?)]+$/, "");
    const host = url.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
    return (
      <span key={at}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {host}
        </a>
        {part.slice(url.length)}
      </span>
    );
  });
}

function PhoneStepper(props: {
  readonly position: { readonly index: number; readonly total: number } | null;
  readonly step: (direction: 1 | -1) => void;
}) {
  const { position, step } = props;
  if (position === null) return null;
  return (
    <div className="flex items-center justify-between pb-2 text-muted-foreground text-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous"
        disabled={position.index === 0}
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <span className="tabular-nums">
        {position.index + 1} of {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next"
        disabled={position.index === position.total - 1}
        onClick={() => step(1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** The thing itself: its screenshot (tap to zoom), with Play on top; Play shows it live. */
function Visual(props: {
  readonly item: GrowReturn;
  readonly wide: boolean;
  readonly playing: boolean;
  readonly screenshots: ReturnType<typeof useThreadReport>["digest"]["screenshots"];
}) {
  const { item } = props;
  const images = useReportImages(item.thread.environmentId, item.thread.id, props.screenshots);
  const [zoom, setZoom] = useState<number | null>(null);
  const image = images[0];
  // The live preview needs the desktop app; elsewhere Play opens a tab.
  const embed = props.wide && isPreviewSupportedInRuntime();
  if (props.playing && embed && item.playUrl !== null) {
    return (
      <div className="flex h-[min(70vh,48rem)] min-h-80 flex-col overflow-hidden rounded-xl border">
        <GrowPreview
          environmentId={item.thread.environmentId}
          threadId={item.thread.id}
          url={item.playUrl}
        />
      </div>
    );
  }
  if (image === undefined && item.playUrl === null) return null;
  const play = item.playUrl ? (
    embed ? (
      <Button size="lg" onClick={() => useReturnsStore.setState({ playing: item.key })}>
        <PlayIcon />
        Play
        <Kbd>P</Kbd>
      </Button>
    ) : (
      <Button
        size="lg"
        render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}
      >
        <PlayIcon />
        Play
      </Button>
    )
  ) : null;
  const host = item.playUrl?.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (image === undefined) {
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-muted/60 p-3">
        {play}
        <span className="min-w-0 truncate text-muted-foreground text-sm">{host}</span>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-xl border bg-muted/60">
      {image ? (
        <button
          type="button"
          className="block w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${image.name}`}
          onClick={() => setZoom(0)}
        >
          <img
            src={image.src ?? undefined}
            alt={image.name}
            className={cn(
              "w-full object-cover object-top",
              props.wide ? "max-h-[52vh]" : "max-h-[38vh]",
            )}
          />
        </button>
      ) : null}
      {play ? (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-3 [&>*]:pointer-events-auto">
          {play}
        </div>
      ) : null}
      {zoom !== null ? (
        <ExpandedImageDialog
          preview={{ images: [...images], index: zoom }}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  );
}

/** The main choice, What if, Let go, each saying what it does; or the way back for what is decided. */
function Choices(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly question: boolean;
  readonly whatIfOpen: boolean;
  readonly setWhatIfOpen: (open: boolean) => void;
  readonly wide: boolean;
}) {
  const { item, actions, wide } = props;
  const openThread = (
    <Button variant="ghost" size={wide ? "sm" : "default"} onClick={() => actions.openThread(item)}>
      <MessageSquareIcon />
      Open thread
      {wide ? <Kbd>O</Kbd> : null}
    </Button>
  );
  if (item.kind === "shipped") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-sm">
          {item.merged ? (
            <>
              <PullRequestGlyph.merged className="size-4 text-success" /> Merged
            </>
          ) : item.shippable ? (
            <>
              <RocketIcon className="size-4 text-info" /> On its way
            </>
          ) : (
            <>
              <CheckIcon className="size-4 text-success" /> Done
            </>
          )}
        </span>
        {item.playUrl ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLinkIcon />
            Open
          </Button>
        ) : null}
        {openThread}
      </div>
    );
  }
  if (item.kind === "letGo") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => actions.bringBack(item)}>
          <Undo2Icon />
          Bring back
        </Button>
        {openThread}
      </div>
    );
  }
  if (props.whatIfOpen) {
    return (
      <WhatIfField
        item={item}
        reply={props.question}
        onSend={(text) => {
          props.setWhatIfOpen(false);
          actions.whatIf(item, text);
        }}
        onCancel={() => props.setWhatIfOpen(false)}
      />
    );
  }
  const ship = (
    <Choice
      label="Ship"
      hint="Merge it the usual way"
      icon={<RocketIcon />}
      keyHint="S"
      primary={!props.question}
      wide={wide}
      onClick={() => actions.ship(item)}
    />
  );
  const done = (
    <Choice
      label="Done"
      hint="Nothing to merge"
      icon={<CheckIcon />}
      keyHint="D"
      primary={!props.question}
      wide={wide}
      onClick={() => actions.done(item)}
    />
  );
  const letGo = (
    <Choice
      label="Let go"
      hint="Off the list, still findable"
      icon={<XIcon />}
      keyHint="L"
      wide={wide}
      onClick={() => actions.letGo(item)}
    />
  );
  if (item.kind === "urgent") {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Choice
          label="Answer"
          hint="In the thread"
          icon={<MessageSquareIcon />}
          keyHint="O"
          primary
          wide={wide}
          onClick={() => actions.openThread(item)}
        />
        <Choice
          label="What if..."
          hint="Change it, same thread"
          icon={<SparklesIcon />}
          keyHint="W"
          wide={wide}
          onClick={() => props.setWhatIfOpen(true)}
        />
        {letGo}
      </div>
    );
  }
  const primary = growPrimary(item, props.question);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {primary === "reply" ? (
          <>
            <Choice
              label="Reply"
              hint="Answer its question"
              icon={<ReplyIcon />}
              keyHint="R"
              primary
              wide={wide}
              onClick={() => props.setWhatIfOpen(true)}
            />
            {item.shippable ? ship : done}
          </>
        ) : (
          <>
            {primary === "ship" ? ship : done}
            <Choice
              label="What if..."
              hint="Change it, same thread"
              icon={<SparklesIcon />}
              keyHint="W"
              wide={wide}
              onClick={() => props.setWhatIfOpen(true)}
            />
          </>
        )}
        {letGo}
      </div>
      <div className="flex justify-center">{openThread}</div>
    </div>
  );
}

function Choice(props: {
  readonly label: string;
  readonly hint: string;
  readonly icon: ReactNode;
  readonly keyHint: string;
  readonly primary?: boolean;
  readonly wide: boolean;
  readonly onClick: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1">
      <Button
        variant={props.primary ? "default" : "outline"}
        size={props.wide ? "lg" : "xl"}
        onClick={props.onClick}
      >
        {props.icon}
        {props.label}
        {props.wide ? <Kbd className="max-sm:hidden">{props.keyHint}</Kbd> : null}
      </Button>
      <span className="text-balance text-center text-muted-foreground text-xs">{props.hint}</span>
    </div>
  );
}

function WhatIfField(props: {
  readonly item: GrowReturn;
  /** Answering the agent's question rather than asking for a change. */
  readonly reply: boolean;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const send = () => {
    if (text.trim() !== "") props.onSend(text.trim());
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <InputGroup>
        <InputGroupAddon>{props.reply ? <ReplyIcon /> : <SparklesIcon />}</InputGroupAddon>
        <InputGroupInput
          nativeInput
          autoFocus
          type="text"
          size="lg"
          aria-label={`${props.reply ? "Reply" : "What if"}, for ${props.item.headline}`}
          placeholder={props.reply ? "Your answer..." : "What if it..."}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
      </InputGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={text.trim() === ""}>
          Send
        </Button>
      </div>
    </form>
  );
}

/** Nothing waits: say so, and offer one old idea that might deserve another look. */
function CaughtUp(props: {
  readonly spark: GrowReturn | null;
  readonly actions: ReturnActions;
  readonly searching: boolean;
}) {
  const { spark } = props;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <p className="font-medium text-lg">{props.searching ? "No matches" : "All caught up"}</p>
      {spark ? (
        <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border bg-card p-4 text-start">
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <SparklesIcon className="size-3.5" />
            One you let go
          </span>
          <span className="font-medium">{spark.headline}</span>
          <div className="flex flex-wrap gap-2">
            {spark.playUrl ? (
              <Button
                variant="outline"
                size="sm"
                render={<a href={spark.playUrl} target="_blank" rel="noopener noreferrer" />}
              >
                <PlayIcon />
                Play
              </Button>
            ) : null}
            <Button size="sm" onClick={() => props.actions.bringBack(spark)}>
              <Undo2Icon />
              Bring back
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReturnsSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 gap-6 p-6 md:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-2 max-md:hidden">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-[16/8] w-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
