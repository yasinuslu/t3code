/**
 * Grow: what the agents made comes back here, one thing at a time. The item
 * shows the thing itself (its screenshot, or the live preview behind Play)
 * and beside it what it is, where it came from and goes, and what happened,
 * then three choices: the main one (Reply to its question, Ship work that can
 * land, or Done for what has nothing to merge), What if, Settle. Settle can
 * also name the thread that superseded this one, with a one-line note; both
 * then show the link in their story, so a chain reads like a thought maturing. The list is
 * what is being worked on, the rest of the queue by project, then what is
 * done and what was settled. On a phone the item takes the screen and the list
 * is one tap away.
 *
 * Nothing here needs agents to fill in extra fields: everything is read off
 * the thread (previews, pull requests, status report, run state). The only
 * things recorded are the decision, in the thread's grow card, and what the
 * user sent from here, on this device (grow.asks).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, GrowDecision, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  ImageIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ImageOffIcon,
  LayersIcon,
  ListIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PlayIcon,
  ReplyIcon,
  RocketIcon,
  SearchIcon,
  SparklesIcon,
  SplitIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";

import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  useEveryManagerThreadKey,
  useManagerProfile,
  useManagerThreadKeys,
  useThreadShellsWithoutBrainstorms,
} from "../../brainstormStore";
import { setGrowManagerToggle } from "../../lib/goToManager";
import { useEnsureManagerThread } from "../brainstorm/useOpenManagerThread";
import { Badge } from "../ui/badge";
import { growIsHome, useHomeOverlayStore } from "../../homeOverlayStore";
import { openFullView, setGrowOnScreen, useGrowFocusStore } from "../../growFocus";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn, newMessageId } from "../../lib/utils";
import { useSidebarThreadRowSlot } from "../../sidebarThreadRowSlot";
import { readThreadShell, useProjects, useThreadShell } from "../../state/entities";
import { growEnvironment, useGrowCards, useGrowLoaded } from "../../state/grow";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatView from "../ChatView";
import { growKeyAction } from "./grow.keys";
import { stepProfile } from "../ProfileShortcuts";
import { useShortcutsSheetOpen } from "../ShortcutsSheet";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { WORK_REASON_LOOK, useReportImages, useThreadReport } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { readEnvironmentSupportsSettlement } from "../../state/entities";
import { type GrowAsk, recordGrowAsk, useGrowAsks } from "./grow.asks";
import { decide, undo, usePendingDecisions } from "./grow.decide";
import { GrowDetails } from "./GrowDetails";
import { GrowPreview } from "./GrowPreview";
import {
  type GrowDeck,
  type GrowRelations,
  type GrowReturn,
  SHIP_MESSAGE,
  buildGrowDeck,
  buildGrowRelations,
  supersedeCandidates,
  supersededChain,
  filterGrowDeck,
  growCurrent,
  growDeckItems,
  growFocusedProject,
  growProjectOpen,
  cleanLabel,
  growNextAfter,
  growParentKey,
  growPrimary,
  growProjectKey,
  growQueue,
  growReturnKey,
  growSpark,
  growStep,
  PROOF_MESSAGE,
} from "./returns.logic";

/** Where the deck is, kept while Home is closed: the shown item, the phone's view, the search. */
const useReturnsStore = create<{
  readonly selected: string | null;
  readonly phoneView: "card" | "list";
  readonly query: string;
  readonly playing: string | null;
  /** The thread whose conversation is open in place of the item: the item's own, or one related to it. */
  readonly thread: string | null;
  /** Every project in the list is open. Temporary: the next item shown, or reopening Grow, puts it back. */
  readonly expandAll: boolean;
  /** How the list is laid out: by project (default), or flat with the last thread touched on top. */
  readonly listMode: "projects" | "recent";
  /** The manager's chat is open in place of the item. */
  readonly manager: boolean;
}>(() => ({
  selected: null,
  phoneView: "card",
  query: "",
  playing: null,
  thread: null,
  expandAll: false,
  listMode: "projects",
  manager: false,
}));

/** Whether Grow shows the manager's pane, for the app bars that mark it. */
export const useGrowShowsManager = () => useReturnsStore((state) => state.manager);

/** What had focus when the manager came up, so Esc can give it back. */
let managerFocusReturn: HTMLElement | null = null;

/** Sent by the B / arrow keys; the proof on screen shows the next or previous screenshot. */
const PROOF_IMAGE_EVENT = "grow:proof-image";

/** Scrolls the item's story (the description under or beside the proof) by most of a page. */
function scrollStory(direction: 1 | -1) {
  const story = document.querySelector<HTMLElement>("[data-grow-story]");
  const scroller = [story, ...(story?.children ?? [])].find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.scrollHeight > element.clientHeight,
  );
  scroller?.scrollBy({ top: direction * scroller.clientHeight * 0.85, behavior: "smooth" });
}

const select = (key: string | null) => {
  managerFocusReturn = null;
  useReturnsStore.setState({
    selected: key,
    phoneView: "card",
    playing: null,
    thread: null,
    manager: false,
  });
};

/** A thread's conversation in place of the item, for one the deck may not hold. */
const showThread = (key: string) => {
  managerFocusReturn = null;
  useReturnsStore.setState({ thread: key, phoneView: "card", playing: null, manager: false });
};

/** `environmentId:threadId` back to a ref; thread ids may hold colons, environment ids do not. */
function threadRefOfKey(key: string): ScopedThreadRef | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  return scopeThreadRef(key.slice(0, at) as EnvironmentId, key.slice(at + 1) as ThreadId);
}

const managerComposer = () =>
  document.querySelector<HTMLElement>('[data-grow-manager] [contenteditable="true"]');

/** Shows the manager's chat in place of the item (T), or focuses its message box when it shows. */
function showManager() {
  if (useReturnsStore.getState().manager) {
    managerComposer()?.focus();
    return;
  }
  const active = document.activeElement;
  managerFocusReturn = active instanceof HTMLElement && active !== document.body ? active : null;
  useReturnsStore.setState({ manager: true, thread: null, playing: null, phoneView: "card" });
}

/** The manager shortcut over Grow: the same as T, and again (like Esc) to go back. */
const toggleManagerPane = () =>
  useReturnsStore.getState().manager ? hideManager() : showManager();

/** Back to the item, with focus where it was before the manager came up. */
function hideManager() {
  const target = managerFocusReturn;
  managerFocusReturn = null;
  useReturnsStore.setState({ manager: false });
  window.requestAnimationFrame(() => {
    if (target?.isConnected) target.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

const proofAsksInFlight = new Set<string>();

/** The actions on a return, wired to the thread and its grow card. */
function useReturnActions(moveOn: (item: GrowReturn) => void) {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const update = useAtomCommand(growEnvironment.update);
  const settleThread = useAtomCommand(threadEnvironment.settle, { reportFailure: false });
  const unsettleThread = useAtomCommand(threadEnvironment.unsettle, { reportFailure: false });
  const setSupersededBy = useAtomCommand(threadEnvironment.setSupersededBy, {
    reportFailure: false,
  });

  const record = (item: GrowReturn, decision: GrowDecision | null) =>
    update({
      environmentId: item.thread.environmentId,
      input: { threadId: item.thread.id, decision },
    });

  const send = async (
    item: GrowReturn,
    text: string,
    kind: GrowAsk["kind"],
    dispatchMode?: "queue",
  ) => {
    const result = await startTurn({
      environmentId: item.thread.environmentId,
      input: {
        threadId: item.thread.id,
        ...(dispatchMode === undefined ? {} : { dispatchMode }),
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: item.thread.runtimeMode,
        interactionMode: item.thread.interactionMode,
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: `Could not reach ${item.headline}` });
      return false;
    }
    recordGrowAsk(item.key, { text, kind, at: Date.now() });
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
          if (await send(item, SHIP_MESSAGE, "ship")) await record(item, "adopt");
        },
      });
    },
    whatIf: (item: GrowReturn, text: string, kind: "whatIf" | "reply") => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Sending to ${item.headline}`,
        run: async () => {
          if ((await send(item, text, kind)) && item.card?.decision !== undefined) {
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
    /**
     * The thread list's settle (the same command), with nothing sent to the agent. The shelve
     * decision keeps it listed under Settled, since agents settle threads too and a settled
     * thread with something to open would otherwise come back as a return.
     */
    settle: (item: GrowReturn) => {
      moveOn(item);
      decide({
        key: item.key,
        title: `Settled ${item.headline}`,
        run: async () => {
          if (readEnvironmentSupportsSettlement(item.thread.environmentId)) {
            const result = await settleThread({
              environmentId: item.thread.environmentId,
              input: { threadId: item.thread.id },
            });
            if (result._tag === "Failure") {
              toastManager.add({ type: "error", title: `Could not settle ${item.headline}` });
              return;
            }
          }
          await record(item, "shelve");
        },
      });
    },
    /**
     * Settle, recording the thread that carries this one's work on and why. The link goes
     * first, so the thread never sits settled without it; a settled card only gains the link.
     */
    supersede: (item: GrowReturn, successor: EnvironmentThreadShell, note: string) => {
      // A settled or shipped card keeps its place and decision; it only gains the link.
      const linkOnly = item.kind === "letGo" || item.kind === "shipped";
      const settled = item.thread.settledAt !== null && item.thread.settledOverride !== "active";
      if (!linkOnly) moveOn(item);
      decide({
        key: item.key,
        title: `${linkOnly ? "Linked" : "Settled"} ${item.headline}, superseded by ${cleanLabel(successor.title)}`,
        run: async () => {
          const result = await setSupersededBy({
            environmentId: item.thread.environmentId,
            input: { threadId: item.thread.id, supersededBy: { threadId: successor.id, note } },
          });
          if (result._tag === "Failure") {
            toastManager.add({ type: "error", title: `Could not link ${item.headline}` });
            return;
          }
          if (!settled && readEnvironmentSupportsSettlement(item.thread.environmentId)) {
            await settleThread({
              environmentId: item.thread.environmentId,
              input: { threadId: item.thread.id },
            });
          }
          if (!linkOnly) await record(item, "shelve");
        },
      });
    },
    bringBack: async (item: GrowReturn) => {
      if (item.thread.settledOverride === "settled") {
        await unsettleThread({
          environmentId: item.thread.environmentId,
          input: { threadId: item.thread.id, reason: "user" },
        });
      }
      await record(item, null);
    },
    // Queued behind whatever the thread is doing, so a busy thread takes the ask when it is
    // free; pressing A again while one is on its way sends nothing more.
    askProof: async (item: GrowReturn) => {
      if (proofAsksInFlight.has(item.key)) return;
      proofAsksInFlight.add(item.key);
      try {
        if (await send(item, PROOF_MESSAGE, "proof", "queue")) {
          toastManager.add({ type: "success", title: `Asked ${item.headline} for proof` });
        }
      } finally {
        proofAsksInFlight.delete(item.key);
      }
    },
    /** The conversation opens inside Grow, so the deck stays one Back away. */
    openThread: (item: GrowReturn) =>
      useReturnsStore.setState({ selected: item.key, phoneView: "card", thread: item.key }),
    /** The thread's full view (diff, terminal, files), for work Grow is too small for. */
    leaveForThread: (thread: EnvironmentThreadShell) =>
      void openFullView(scopeThreadRef(thread.environmentId, thread.id)),
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
  const { selected, phoneView, query, playing, thread, listMode, manager } = useReturnsStore();
  const wide = useMediaQuery("md");
  const split = useMediaQuery("lg");
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  useEffect(() => setGrowManagerToggle(toggleManagerPane), []);

  const deck = useMemo(
    () =>
      buildGrowDeck(props.threads, cards, props.now, {
        excluded: managers.keys,
        pending,
        grouping: listMode,
      }),
    [cards, listMode, managers.keys, pending, props.now, props.threads],
  );
  const shown = useMemo(() => filterGrowDeck(deck, query), [deck, query]);
  const relations = useMemo(() => buildGrowRelations(props.threads, cards), [cards, props.threads]);
  const actions = useReturnActions((item) => select(growNextAfter(shown, item.key)));
  const current = growCurrent(shown, selected);
  const queue = growQueue(shown);
  const spark = queue.length === 0 && query === "" ? growSpark(deck) : null;
  const ready = loaded && managers.known;

  // Changing what shows closes the What if field.
  const currentKey = current?.key ?? null;
  // Expanding every project lasts until the next item is shown (and Grow mounts afresh).
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-arms on each item shown
  useEffect(() => useReturnsStore.setState({ expandAll: false }), [currentKey]);
  const [whatIfFor, setWhatIfFor] = useState(currentKey);
  if (whatIfFor !== currentKey) {
    setWhatIfFor(currentKey);
    setWhatIfOpen(false);
    setSupersedeOpen(false);
  }

  // A thread opened from a link may be one the deck leaves out (settled, archived, idle, a
  // manager, another space); it is read on its own, not through the deck's threads.
  const linkedShell = useThreadShell(
    thread === null || relations.byKey.has(thread) ? null : threadRefOfKey(thread),
  );
  const threadShell =
    thread === null ? undefined : (relations.byKey.get(thread) ?? linkedShell ?? undefined);
  // A conversation only shows while its thread is still known; a key
  // handler that trusted `thread` alone kept the deck's keys dead behind a deck.
  const conversationOpen = threadShell !== undefined;
  useEffect(() => {
    if (ready && thread !== null && !conversationOpen) useReturnsStore.setState({ thread: null });
  }, [conversationOpen, ready, thread]);

  // A related thread opens as its item when it is in the deck, else as its conversation, in place.
  const openRelated = (related: EnvironmentThreadShell) => {
    const key = growReturnKey(related);
    if (growCurrent(shown, key)?.key === key) select(key);
    else useReturnsStore.setState({ thread: key });
  };

  const sheetOpen = useShortcutsSheetOpen();
  // A thread link landed (GrowRouting): show that thread, as its item when the deck has it.
  const focusTarget = useGrowFocusStore((state) => state.target);
  const focusManager = useGrowFocusStore((state) => state.manager);
  useEffect(() => {
    if (!focusManager) return;
    useGrowFocusStore.setState({ manager: false });
    showManager();
  }, [focusManager]);
  useEffect(() => {
    if (!ready || focusTarget === null) return;
    useGrowFocusStore.setState({ target: null });
    if (!growDeckItems(deck).some((item) => item.key === focusTarget)) {
      const ref = threadRefOfKey(focusTarget);
      // A thread this app does not hold (gone, or on a server not connected yet) gets the
      // thread page, which knows how to wait for it or say it is not there.
      if (ref !== null && readThreadShell(ref) === null) openFullView(ref);
      else showThread(focusTarget);
      return;
    }
    if (!growDeckItems(shown).some((item) => item.key === focusTarget)) {
      useReturnsStore.setState({ query: "" });
    }
    select(focusTarget);
  }, [deck, focusTarget, ready, shown]);

  // What shows is the thread the app is on: the route follows it (so a reload, Back and
  // a link to it agree with the screen), and the full view opens it.
  const onScreenKey = manager
    ? null
    : threadShell
      ? growReturnKey(threadShell)
      : (current?.key ?? null);
  const onScreen = useMemo(
    () => (onScreenKey === null ? null : threadRefOfKey(onScreenKey)),
    [onScreenKey],
  );
  const navigate = useNavigate();
  const landed = useGrowFocusStore((state) => state.landed);
  const growOpen = useHomeOverlayStore((state) => state.open);
  useEffect(() => {
    if (!ready || onScreen === null) return setGrowOnScreen(() => null);
    const unregister = setGrowOnScreen(() => onScreen);
    // Not before the page load's own link is read and shown, or it would be overwritten.
    if (growIsHome() && growOpen && landed && focusTarget === null) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: onScreen.environmentId, threadId: onScreen.threadId },
        replace: true,
      });
    }
    return unregister;
  }, [focusTarget, growOpen, landed, navigate, onScreen, ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The cheat sheet owns the keyboard while it shows.
      if (sheetOpen || isTyping(event.target)) return;
      const action = growKeyAction(event, {
        conversationOpen,
        conversationShown: wide && split,
        managerOpen: manager,
        inChat:
          event.target instanceof Element && event.target.closest('[data-pane="chat"]') !== null,
        item: current,
      });
      if (action === null) return;
      const item = current;
      switch (action.type) {
        case "closeThread":
          useReturnsStore.setState({ thread: null });
          break;
        case "manager":
          showManager();
          break;
        case "profile":
          stepProfile(action.direction);
          break;
        case "toggleProjects":
          // Everything with a match is already open while searching.
          if (query.trim() === "") {
            useReturnsStore.setState((state) => ({ expandAll: !state.expandAll }));
          }
          break;
        case "step":
          select(growStep(shown, item?.key ?? null, action.direction));
          break;
        case "undo":
          if (!undo()) return;
          break;
        case "search":
          document.querySelector<HTMLElement>("[data-grow-search]")?.focus();
          break;
        case "whatIf":
          setWhatIfOpen(true);
          break;
        case "ship":
          if (item !== null) actions.ship(item);
          break;
        case "done":
          if (item !== null) actions.done(item);
          break;
        case "settle":
          if (item !== null) actions.settle(item);
          break;
        case "supersede":
          setWhatIfOpen(false);
          setSupersedeOpen(true);
          break;
        case "chain": {
          const from = threadShell ?? item?.thread;
          if (from === undefined) return;
          const next =
            action.direction === 1
              ? supersededChain(relations, from)[0]?.thread
              : relations.supersedes.get(growReturnKey(from))?.at(-1);
          if (next === undefined) return;
          openRelated(next);
          break;
        }
        case "askProof":
          if (item !== null) void actions.askProof(item);
          break;
        case "openThread":
          if (item !== null) actions.openThread(item);
          break;
        case "image":
          window.dispatchEvent(new CustomEvent(PROOF_IMAGE_EVENT, { detail: action.direction }));
          break;
        case "scrollStory":
          scrollStory(action.direction);
          break;
        case "play":
          if (item === null || item.playUrl === null) return;
          if (wide) useReturnsStore.setState({ playing: playing === item.key ? null : item.key });
          else window.open(item.playUrl, "_blank", "noopener");
          break;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    actions,
    conversationOpen,
    current,
    manager,
    openRelated,
    playing,
    query,
    relations,
    sheetOpen,
    shown,
    split,
    threadShell,
    wide,
  ]);

  // Esc leaves the manager or an open conversation even from its message box, which keeps
  // Esc from bubbling; caught before it, and left alone while a menu or dialog is open.
  useEffect(() => {
    if (!manager) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      hideManager();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [manager]);
  useEffect(() => {
    if (!conversationOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      useReturnsStore.setState({ thread: null });
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [conversationOpen]);

  if (!ready) return <ReturnsSkeleton />;

  const header = (
    <ReturnsHeader
      today={deck.urgent.length + deck.returns.length}
      working={deck.working.length}
      query={query}
      phoneList={
        !wide && phoneView === "card" ? () => useReturnsStore.setState({ phoneView: "list" }) : null
      }
    />
  );
  const hero = manager ? (
    <ManagerPane wide={wide} />
  ) : threadShell ? (
    <ThreadPane
      thread={threadShell}
      title={current?.key === thread ? current.headline : cleanLabel(threadShell.title)}
      actions={actions}
      wide={wide}
      outside={
        growDeckItems(deck).some((item) => item.key === thread)
          ? null
          : outsideDeckLabel(threadShell, managers.keys.has(growReturnKey(threadShell)))
      }
    />
  ) : current ? (
    <Hero
      item={current}
      actions={actions}
      relations={relations}
      open={openRelated}
      wide={wide}
      split={split}
      playing={playing === current.key}
      whatIfOpen={whatIfOpen}
      setWhatIfOpen={setWhatIfOpen}
      supersedeOpen={supersedeOpen}
      setSupersedeOpen={setSupersedeOpen}
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
            <ReturnsList deck={shown} current={currentKey} managerOpen={manager} />
            <SidebarChromeFooter />
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
      className="grid min-h-0 flex-1 grid-cols-[clamp(15rem,20vw,22rem)_minmax(0,1fr)]"
      data-grow-returns="wide"
    >
      <div
        className="flex min-h-0 flex-col border-e ps-(--workspace-gutter-start) pe-3 pt-3"
        data-pane="sidebar"
      >
        {header}
        <ReturnsList deck={shown} current={currentKey} managerOpen={manager} />
        {/* The thread list's own footer: Settings, Pull Requests, Usage, and the update pill. */}
        <SidebarChromeFooter />
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
            placeholder="Search  F"
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

/** What is being worked on, the queue by project, then the older ones, what shipped and what was settled (folded). */
function ReturnsList(props: {
  readonly deck: GrowDeck;
  readonly current: string | null;
  readonly managerOpen: boolean;
}) {
  const { deck } = props;
  const projectTitle = useProjectTitle();
  // Searching opens every group that has a match, folded sections too; clearing the search
  // returns to the focused project only (or what Expand all holds).
  const searching = useReturnsStore((state) => state.query.trim() !== "");
  const expandAll = useReturnsStore((state) => state.expandAll) || searching;
  const foldOpen = searching ? { open: true } : {};
  const listMode = useReturnsStore((state) => state.listMode);
  const focused = growFocusedProject(deck, props.current);
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
  const row = (item: GrowReturn, showProject = false) => (
    <ReturnRow
      key={item.key}
      item={item}
      current={item.key === props.current}
      showProject={showProject}
    />
  );
  return (
    <nav aria-label="Returns" className="@container -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-6">
      <ManagerRow open={props.managerOpen} />
      <div className="flex items-center justify-between gap-2">
        <ToggleGroup
          aria-label="List"
          variant="segmented"
          value={[listMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "projects" || next === "recent") {
              useReturnsStore.setState({ listMode: next, expandAll: false });
            }
          }}
        >
          <Toggle value="projects" aria-label="By project">
            By project
          </Toggle>
          <Toggle value="recent" aria-label="Recent">
            Recent
          </Toggle>
        </ToggleGroup>
        {listMode === "projects" && groups.length > 1 && !searching ? (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={expandAll}
            onClick={() => useReturnsStore.setState({ expandAll: !expandAll })}
          >
            {expandAll ? (
              <ChevronsDownUpIcon className="size-3.5" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5" />
            )}
            <span className="whitespace-nowrap @max-[16rem]:sr-only">
              {expandAll ? "Only this project" : "Expand all"}
            </span>
            <span className="hidden md:@min-[15.5rem]:contents">
              <Kbd>G</Kbd>
            </span>
          </button>
        ) : null}
      </div>
      {deck.working.length > 0 ? (
        <ListSection title="Working">{deck.working.map((item) => row(item))}</ListSection>
      ) : null}
      {deck.urgent.length > 0 ? (
        <ListSection title="Needs you now" tone="warning">
          {deck.urgent.map((item) => row(item))}
        </ListSection>
      ) : null}
      {listMode === "recent" ? (
        deck.returns.length > 0 ? (
          <ListSection title={`Recent (${deck.returns.length})`}>
            {deck.returns.map((item) => row(item, true))}
          </ListSection>
        ) : null
      ) : (
        groups.map(([key, group]) => (
          <ListSection
            key={key}
            title={`${group.title} (${group.items.length})`}
            open={growProjectOpen(key, focused, expandAll)}
            resetOn={props.current}
          >
            {group.items.map((item) => row(item))}
          </ListSection>
        ))
      )}
      {deck.older.length > 0 ? (
        <ListSection title={`Earlier (${deck.older.length})`} folded {...foldOpen}>
          {deck.older.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.shipped.length > 0 ? (
        <ListSection title={`Done this week (${deck.shipped.length})`} folded {...foldOpen}>
          {deck.shipped.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.letGo.length > 0 ? (
        <ListSection title={`Settled (${deck.letGo.length})`} folded {...foldOpen}>
          {deck.letGo.map((item) => row(item))}
        </ListSection>
      ) : null}
    </nav>
  );
}

function ListSection(props: {
  readonly title: string;
  readonly tone?: "warning";
  readonly folded?: boolean;
  /** Whether it is open until clicked; defaults to open, or closed when folded. A click holds until `open` or `resetOn` changes. */
  readonly open?: boolean;
  readonly resetOn?: string | null;
  readonly children: ReactNode;
}) {
  const initial = props.open ?? !props.folded;
  const [clicked, setClicked] = useState<{ readonly from: string; readonly open: boolean } | null>(
    null,
  );
  const stamp = `${initial}:${props.resetOn ?? ""}`;
  const open = clicked !== null && clicked.from === stamp ? clicked.open : initial;
  return (
    <section className="pt-3">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded px-1 pb-1 text-start font-medium text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
          props.tone === "warning" && "text-warning-foreground",
        )}
        aria-expanded={open}
        onClick={() => setClicked({ from: stamp, open: !open })}
      >
        <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {props.title}
      </button>
      {open ? <ul className="flex flex-col gap-0.5">{props.children}</ul> : null}
    </section>
  );
}

/**
 * One item in the list: the sidebar's own thread row (status, branch, actions, context menu)
 * with Grow's marks added; Grow's compact row when the sidebar is not mounted.
 */
function ReturnRow(props: {
  readonly item: GrowReturn;
  readonly current: boolean;
  /** Names the item's project, for a list that is not grouped by it. */
  readonly showProject: boolean;
}) {
  const { item } = props;
  const sidebarRow = useSidebarThreadRowSlot((state) => state.render);
  if (sidebarRow) {
    return sidebarRow(item.thread, {
      isActive: props.current,
      onSelect: () => select(item.key),
      accessory: (
        <>
          <RowMark item={item} />
          <ProofMark item={item} />
        </>
      ),
    });
  }
  return <OwnReturnRow {...props} />;
}

/** Grow's compact row, while the sidebar is not mounted (a phone, or the sidebar closed). */
function OwnReturnRow(props: {
  readonly item: GrowReturn;
  readonly current: boolean;
  readonly showProject: boolean;
}) {
  const { item } = props;
  const projectTitle = useProjectTitle();
  // The shown item says where it lives; a list that is not grouped by project names it on every row.
  const rowRef = useRef<HTMLButtonElement>(null);
  // Q / E / J / K move the selection; while the list holds focus, the focus goes with it.
  useEffect(() => {
    const row = rowRef.current;
    const active = document.activeElement;
    // Only from another row: a search box that is being typed in keeps its focus.
    if (
      props.current &&
      row &&
      active instanceof HTMLButtonElement &&
      row.closest("nav")?.contains(active)
    ) {
      row.focus();
    }
  }, [props.current]);
  const meta = [
    props.showProject ? projectTitle(item.thread) : null,
    props.current ? item.thread.branch : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        aria-current={props.current ? "true" : undefined}
        className={cn(
          "relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          props.current &&
            "bg-primary/15 font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary hover:bg-primary/20",
        )}
        onClick={() => select(item.key)}
      >
        <RowMark item={item} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 break-words">{item.headline}</span>
          {meta ? (
            <span className="truncate font-normal text-muted-foreground text-xs">{meta}</span>
          ) : null}
        </span>
        <ProofMark item={item} />
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
  if (item.kind === "working") {
    return <CircleDotIcon aria-label="Working" className="size-3.5 shrink-0 text-info" />;
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

/** Whether the item came back with a proof image; nothing while it is still being worked on. */
function ProofMark(props: { readonly item: GrowReturn }) {
  if (props.item.kind === "working") return null;
  return props.item.thread.statusProof ? (
    <ImageIcon aria-label="Has proof" className="size-3.5 shrink-0 text-success" />
  ) : (
    <ImageOffIcon aria-label="No proof" className="size-3.5 shrink-0 text-warning" />
  );
}

/**
 * The manager, pinned above the list in every view and search. It is not an
 * item: Q and E step past it, and T (or a click) brings it up.
 */
function ManagerRow(props: { readonly open: boolean }) {
  const profile = useManagerProfile();
  const managerKeys = useManagerThreadKeys();
  const threads = useThreadShellsWithoutBrainstorms();
  const working = useMemo(
    () =>
      threads.some(
        (thread) =>
          managerKeys.has(`${thread.environmentId}:${thread.id}`) &&
          threadRuntimeIsActive(thread.runtime),
      ),
    [managerKeys, threads],
  );
  return (
    <button
      type="button"
      data-grow-manager-row=""
      aria-current={props.open ? "true" : undefined}
      className={cn(
        "mb-2 flex h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        props.open
          ? "bg-primary/25 ring-1 ring-primary/70 ring-inset"
          : "bg-primary/6 hover:bg-primary/12",
      )}
      onClick={toggleManagerPane}
    >
      <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="font-medium">Manager</span>
      {profile ? (
        <span className="min-w-0 truncate text-muted-foreground text-xs">{profile}</span>
      ) : null}
      <span className="flex-1" />
      {working ? (
        <span aria-label="Manager is working" className="size-1.5 shrink-0 rounded-full bg-info" />
      ) : null}
      <span className="hidden md:contents">
        <Kbd>T</Kbd>
      </span>
    </button>
  );
}

/**
 * The manager's chat in place of the item: the same thread the manager
 * shortcut opens, without leaving Grow. Esc gives focus back.
 */
function ManagerPane(props: { readonly wide: boolean }) {
  const manager = useEnsureManagerThread();
  const profile = useManagerProfile();
  // A manager the server just made, or one this client has not loaded yet, has no thread here
  // for a moment; until then the chat would say there is no thread.
  const shellKnown =
    useThreadShell(
      manager._tag === "Ready"
        ? { environmentId: manager.environmentId, threadId: manager.threadId }
        : null,
    ) !== null;
  return (
    <section
      aria-label="Manager"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-primary/10"
      data-grow-manager=""
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-30 ring-2 ring-primary/80 ring-inset"
      />
      <div className="flex items-center gap-2 border-primary/50 border-b bg-primary/20 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={hideManager}>
          <ArrowLeftIcon />
          Back
          {props.wide ? <Kbd>Esc</Kbd> : null}
        </Button>
        <Badge size="lg">
          <MessagesSquareIcon aria-hidden />
          Manager
        </Badge>
        {profile ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">{profile}</span>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size={props.wide ? "sm" : "icon-sm"}
          aria-label="Full view: diff, terminal, files"
          disabled={manager._tag !== "Ready"}
          onClick={() => {
            if (manager._tag === "Ready") {
              openFullView(scopeThreadRef(manager.environmentId, manager.threadId));
            }
          }}
        >
          <ExternalLinkIcon />
          {props.wide ? "Full view" : null}
        </Button>
      </div>
      {manager._tag === "Ready" && shellKnown ? (
        <ChatView
          key={`${manager.environmentId}:${manager.threadId}`}
          environmentId={manager.environmentId}
          threadId={manager.threadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
          autoFocusComposer
          embedded
        />
      ) : manager._tag === "Failed" ? (
        <div className="m-auto flex max-w-sm flex-col gap-1 p-6 text-center">
          <p className="font-medium">
            {manager.offline ? "Manager host offline" : "The manager could not open"}
          </p>
          <p className="text-muted-foreground text-sm">{manager.message}</p>
        </div>
      ) : (
        <div className="m-auto text-muted-foreground text-sm">Opening the manager…</div>
      )}
    </section>
  );
}

/** The quiet note on a thread Grow's list leaves out, saying what it is instead. */
function outsideDeckLabel(thread: EnvironmentThreadShell, isManager: boolean): string {
  if (isManager) return "Manager · not in the list";
  if (thread.archivedAt !== null) return "Archived · not in the list";
  if (thread.settledAt !== null && thread.settledOverride !== "active") {
    return "Settled · not in the list";
  }
  return "Not in the list";
}

/** A thread's conversation in place of the card: read it, answer it, then Back to the deck. */
function ThreadPane(props: {
  readonly thread: EnvironmentThreadShell;
  readonly title: string;
  readonly actions: ReturnActions;
  readonly wide: boolean;
  /** Why the deck does not list it, for a thread opened from a link; null when it does. */
  readonly outside: string | null;
}) {
  const { thread } = props;
  return (
    <section
      aria-label={`Thread: ${props.title}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-grow-thread=""
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useReturnsStore.setState({ thread: null })}
        >
          <ArrowLeftIcon />
          Back
          {props.wide ? <Kbd>Esc</Kbd> : null}
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{props.title}</span>
        {props.outside ? (
          <span className="shrink-0 text-muted-foreground text-xs" data-grow-outside="">
            {props.outside}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size={props.wide ? "sm" : "icon-sm"}
          aria-label="Full view: diff, terminal, files"
          onClick={() => props.actions.leaveForThread(thread)}
        >
          <ExternalLinkIcon />
          {props.wide ? "Full view" : null}
        </Button>
      </div>
      <ChatView
        key={growReturnKey(thread)}
        environmentId={thread.environmentId}
        threadId={thread.id}
        routeKind="server"
        reserveTitleBarControlInset={false}
        autoFocusComposer={false}
        embedded
      />
    </section>
  );
}

/**
 * The item's conversation beside its proof. One chat view stays mounted while j and k
 * step through the items, the way the thread route reuses it, so stepping stays instant.
 */
function Conversation(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  return (
    <section
      aria-label="Conversation"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-grow-conversation=""
    >
      <ChatView
        environmentId={thread.environmentId}
        threadId={thread.id}
        routeKind="server"
        reserveTitleBarControlInset={false}
        autoFocusComposer={false}
        embedded
        statusReport={false}
        typeToFocusComposer={false}
      />
    </section>
  );
}

/**
 * One item, read in the order a glance needs: the thing itself in the middle,
 * and beside it what it is, where it came from and where it goes, and what
 * happened inside. The conversation is one click further.
 */
function Hero(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly relations: GrowRelations;
  readonly open: (thread: EnvironmentThreadShell) => void;
  readonly wide: boolean;
  /** Wide enough for the conversation beside the proof; narrower, it is one O away. */
  readonly split: boolean;
  readonly playing: boolean;
  readonly whatIfOpen: boolean;
  readonly setWhatIfOpen: (open: boolean) => void;
  readonly supersedeOpen: boolean;
  readonly setSupersedeOpen: (open: boolean) => void;
  readonly position: { readonly index: number; readonly total: number } | null;
  readonly step: (direction: 1 | -1) => void;
}) {
  const { item, actions, wide } = props;
  const { digest } = useThreadReport(item.thread);
  const images = useReportImages(item.thread.environmentId, item.thread.id, digest.screenshots);
  const question = digest.questions[0] ?? null;
  const visual = (
    <Visual
      key={item.key}
      item={item}
      actions={actions}
      wide={wide}
      playing={props.playing}
      images={images}
      fit={props.split}
    />
  );
  const choices = (stacked: boolean) => (
    <Choices
      item={item}
      actions={actions}
      question={question !== null}
      whatIfOpen={props.whatIfOpen}
      setWhatIfOpen={props.setWhatIfOpen}
      supersedeOpen={props.supersedeOpen}
      setSupersedeOpen={props.setSupersedeOpen}
      relations={props.relations}
      wide={wide}
      stacked={stacked}
      conversationShown={wide && props.split}
    />
  );
  const story = (
    <Story
      item={item}
      actions={actions}
      conversationShown={wide && props.split}
      relations={props.relations}
      open={props.open}
      digest={digest}
      position={wide ? props.position : null}
    />
  );

  if (!wide) {
    return (
      <article aria-label={item.headline} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-4">
          {visual}
          {story}
        </div>
        <div className="shrink-0 border-t bg-background px-3 pt-2 pb-3">
          <PhoneStepper position={props.position} step={props.step} />
          {choices(false)}
        </div>
      </article>
    );
  }
  if (!props.split) {
    return (
      <article
        aria-label={item.headline}
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]"
      >
        <div className="flex min-h-0 min-w-0 flex-col p-5" data-pane="proof">
          {visual}
        </div>
        <aside
          aria-label="About it"
          className="flex min-h-0 flex-col border-s bg-background/40"
          data-grow-story=""
          data-pane="story"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">{story}</div>
          <div className="shrink-0 border-t p-4">{choices(true)}</div>
        </aside>
      </article>
    );
  }
  // The conversation beside the thing it made; the proof takes the height it needs (Live
  // takes more), the story the rest, and the choices stay pinned under them.
  const live = props.playing && item.playUrl !== null;
  return (
    <article
      aria-label={item.headline}
      className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,1fr)_minmax(24rem,1.1fr)]"
    >
      <div className="flex min-h-0 min-w-0 flex-col border-e">
        <Conversation thread={item.thread} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col" data-pane="proof">
        <div
          className={cn(
            "flex min-h-0 flex-col p-3 pb-0",
            live ? "flex-[1.6]" : "max-h-[60%] shrink-0",
          )}
        >
          {visual}
        </div>
        <aside
          aria-label="About it"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
          data-grow-story=""
        >
          {story}
        </aside>
        <div className="shrink-0 border-t p-3">{choices(false)}</div>
      </div>
    </article>
  );
}

const STATUS_LOOK = {
  urgent: { label: "Needs you", dot: "bg-warning" },
  answer: { label: "Waiting for your answer", dot: "bg-warning" },
  ready: { label: "Ready for you", dot: "bg-info" },
  working: { label: "Working", dot: "bg-info" },
  merged: { label: "Merged", dot: "bg-success" },
  shipping: { label: "Shipping", dot: "bg-info" },
  done: { label: "Done", dot: "bg-success" },
  letGo: { label: "Settled", dot: "bg-muted-foreground" },
} as const;

function statusOf(item: GrowReturn, question: boolean): keyof typeof STATUS_LOOK {
  switch (item.kind) {
    case "urgent":
      return "urgent";
    case "working":
      return "working";
    case "letGo":
      return "letGo";
    case "shipped":
      return item.merged ? "merged" : item.shippable ? "shipping" : "done";
    case "return":
      return question ? "answer" : "ready";
  }
}

/** What it is, where it came from and goes, and what happened: what an agent wrote, as highlights. */
function Story(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly relations: GrowRelations;
  readonly open: (thread: EnvironmentThreadShell) => void;
  readonly digest: ReturnType<typeof useThreadReport>["digest"];
  readonly position: { readonly index: number; readonly total: number } | null;
  /** The conversation shows beside the story, so it needs no way in. */
  readonly conversationShown: boolean;
}) {
  const { item, digest } = props;
  const projectTitle = useProjectTitle();
  const question = digest.questions[0] ?? null;
  const status =
    item.kind === "urgent" && item.reason
      ? { label: WORK_REASON_LOOK[item.reason].label, dot: WORK_REASON_LOOK[item.reason].dot }
      : STATUS_LOOK[statusOf(item, question !== null)];
  const subtitle = cleanLabel(item.thread.title);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="What it is" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span aria-hidden className={cn("size-2 rounded-full", status.dot)} />
            {status.label}
          </span>
          <span aria-hidden>·</span>
          <span>{projectTitle(item.thread)}</span>
          <span aria-hidden>·</span>
          <span>{formatRelativeTimeLabel(item.lastActivityAt)}</span>
          {props.position ? (
            <span className="ms-auto tabular-nums">
              {props.position.index + 1} of {props.position.total}
            </span>
          ) : null}
        </div>
        <h2 className="font-semibold text-2xl leading-tight">{item.headline}</h2>
        {subtitle !== item.headline ? (
          <p className="truncate text-muted-foreground text-sm">{subtitle}</p>
        ) : null}
        {digest.summary ? (
          <p className="text-sm leading-relaxed">
            <WithLinks text={digest.summary} />
          </p>
        ) : null}
        {question ? (
          <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm">
            <span className="font-medium">Asks: </span>
            <WithLinks text={question} />
          </div>
        ) : null}
      </section>
      <StoryPath item={item} relations={props.relations} open={props.open} />
      {digest.bullets.length > 0 ? (
        <section aria-label="What happened" className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-xs">What happened</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {digest.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/60" />
                <span className="min-w-0">
                  <WithLinks text={bullet} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <GrowDetails item={item} />
      {props.conversationShown ? null : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => props.actions.openThread(item)}
        >
          <MessageSquareIcon />
          Whole conversation
          <Kbd>C</Kbd>
        </Button>
      )}
    </div>
  );
}

/**
 * Where it came from (the thread it branched off, or who started it), what
 * you sent it from Grow, where it stands now (pull request, preview), and the
 * threads that came out of it. Each step opens without leaving Grow.
 */
function StoryPath(props: {
  readonly item: GrowReturn;
  readonly relations: GrowRelations;
  readonly open: (thread: EnvironmentThreadShell) => void;
}) {
  const { item, relations } = props;
  const asks = useGrowAsks((state) => state.asks[item.key]);
  const parentKey = growParentKey(item.thread, item.card);
  const parent = parentKey === null ? undefined : relations.byKey.get(parentKey);
  const children = relations.children.get(item.key) ?? [];
  const supersedes = relations.supersedes.get(item.key) ?? [];
  const supersededBy = supersededChain(relations, item.thread);
  const lastAsk = asks?.at(-1);
  const started =
    item.thread.createdBy === "agent"
      ? "Started by an agent"
      : item.thread.createdBy === "user"
        ? "Started by you"
        : "Started";

  return (
    <section aria-label="Where it came from and where it goes" className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs">
        Where it came from, where it goes
      </h3>
      <ol className="flex flex-col">
        {supersedes.length > 0 ? (
          <PathStep icon={<LayersIcon />} label="Supersedes">
            <span className="flex flex-col items-start gap-1">
              {supersedes.map((older) => (
                <SupersedeEntry
                  key={older.id}
                  thread={older}
                  note={older.supersededBy?.note ?? ""}
                  open={props.open}
                />
              ))}
            </span>
          </PathStep>
        ) : null}
        <PathStep icon={<GitBranchIcon />} label="From">
          {parent ? (
            <PathLink onClick={() => props.open(parent)}>{cleanLabel(parent.title)}</PathLink>
          ) : (
            <span>
              {started}, {formatRelativeTimeLabel(item.thread.createdAt)}
            </span>
          )}
        </PathStep>
        {(asks ?? []).map((ask) => (
          <PathStep
            key={ask.at}
            icon={ASK_LOOK[ask.kind].icon}
            label={ASK_LOOK[ask.kind].label}
            active={ask === lastAsk && item.kind === "working"}
          >
            {ask.kind === "ship" || ask.kind === "proof" ? null : (
              <span className="italic">&ldquo;{ask.text}&rdquo;</span>
            )}
            <span className="text-muted-foreground text-xs">
              {" "}
              {formatRelativeTimeLabel(new Date(ask.at).toISOString())}
              {ask === lastAsk && item.kind === "working" ? ", working on it" : ""}
            </span>
          </PathStep>
        ))}
        <PathStep
          icon={<CircleDotIcon />}
          label="Now"
          last={children.length === 0 && supersededBy.length === 0}
        >
          <NowLine item={item} />
        </PathStep>
        {supersededBy.length > 0 ? (
          <PathStep
            icon={<ArrowRightIcon />}
            label="Superseded by"
            active
            last={children.length === 0}
          >
            <span className="flex flex-col items-start gap-1">
              {supersededBy.map((step) => (
                <SupersedeEntry
                  key={step.thread.id}
                  thread={step.thread}
                  note={step.note}
                  open={props.open}
                />
              ))}
            </span>
          </PathStep>
        ) : null}
        {children.length > 0 ? (
          <PathStep icon={<SplitIcon />} label="Led to" last>
            <span className="flex flex-col items-start gap-0.5">
              {children.map((child) => (
                <PathLink key={child.id} onClick={() => props.open(child)}>
                  {cleanLabel(child.title)}
                </PathLink>
              ))}
            </span>
          </PathStep>
        ) : null}
      </ol>
    </section>
  );
}

/** One thread in a supersede chain: its link, then the note it was let go with. */
function SupersedeEntry(props: {
  readonly thread: EnvironmentThreadShell;
  readonly note: string;
  readonly open: (thread: EnvironmentThreadShell) => void;
}) {
  return (
    <span className="flex min-w-0 max-w-full flex-col">
      <PathLink onClick={() => props.open(props.thread)}>{cleanLabel(props.thread.title)}</PathLink>
      {props.note === "" ? null : (
        <span className="text-muted-foreground text-xs">{props.note}</span>
      )}
    </span>
  );
}

const ASK_LOOK = {
  ship: { icon: <RocketIcon />, label: "You said ship" },
  reply: { icon: <ReplyIcon />, label: "You replied" },
  whatIf: { icon: <SparklesIcon />, label: "Your what if" },
  proof: { icon: <ImageIcon />, label: "You asked for proof" },
} as const;

function NowLine(props: { readonly item: GrowReturn }) {
  const { item } = props;
  const link = "underline underline-offset-2 hover:text-foreground";
  const parts: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (item.kind === "working") parts.push({ key: "working", node: "An agent is on it" });
  if (item.pullRequest) {
    parts.push({
      key: "pr",
      node: (
        <a href={item.pullRequest.url} target="_blank" rel="noopener noreferrer" className={link}>
          PR #{item.pullRequest.number}
          {item.pullRequest.state ? ` ${item.pullRequest.state}` : ""}
        </a>
      ),
    });
  } else if (item.thread.branch) {
    parts.push({ key: "branch", node: `on ${item.thread.branch}, no PR yet` });
  }
  if (item.playUrl) {
    parts.push({
      key: "preview",
      node: (
        <a href={item.playUrl} target="_blank" rel="noopener noreferrer" className={link}>
          {item.playUrl.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "")}
        </a>
      ),
    });
  }
  if (parts.length === 0) parts.push({ key: "none", node: "A conversation, nothing to land" });
  return (
    <span className="flex flex-wrap gap-x-1.5">
      {parts.map((part, index) => (
        <span key={part.key} className="inline-flex min-w-0 gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
          ) : null}
          <span className="min-w-0 truncate">{part.node}</span>
        </span>
      ))}
    </span>
  );
}

function PathStep(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly active?: boolean;
  readonly last?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3", props.last ? null : "pb-3")}>
      {props.last ? null : (
        <span aria-hidden className="absolute start-[0.6875rem] top-6 bottom-0 w-px bg-border" />
      )}
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground [&>svg]:size-3.5",
          props.active && "border-info text-info",
        )}
      >
        {props.icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5 text-sm">
        <span className="text-muted-foreground text-xs">{props.label}</span>
        <div className="min-w-0">{props.children}</div>
      </div>
    </li>
  );
}

function PathLink(props: { readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button
      type="button"
      className="max-w-full truncate text-start underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={props.onClick}
    >
      {props.children}
    </button>
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

/**
 * The thing itself. On a wide screen one stage switches between the proof (the
 * report's images, whole, click to zoom) and Live (the running preview, loaded
 * only when asked), with `P`. On a phone the proof sits above the story and
 * Play opens a tab.
 */
function Visual(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly wide: boolean;
  readonly playing: boolean;
  readonly images: ReturnType<typeof useReportImages>;
  /** As tall as the proof needs (capped), leaving the rest to the story; Live still fills. */
  readonly fit?: boolean;
}) {
  const { item, images } = props;
  const [shown, setShown] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const index = Math.min(shown, images.length - 1);
  const image = images[index];
  useEffect(() => {
    const onStep = (event: Event) => {
      const direction = event instanceof CustomEvent && event.detail === -1 ? -1 : 1;
      setShown((current) =>
        Math.max(0, Math.min(images.length - 1, Math.min(current, images.length - 1) + direction)),
      );
    };
    window.addEventListener(PROOF_IMAGE_EVENT, onStep);
    return () => window.removeEventListener(PROOF_IMAGE_EVENT, onStep);
  }, [images.length]);
  const host = item.playUrl?.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  const live = props.wide && props.playing && item.playUrl !== null;
  const zoomDialog =
    zoom === null ? null : (
      <ExpandedImageDialog
        preview={{ images: [...images], index: zoom }}
        onClose={() => setZoom(null)}
      />
    );
  const proof =
    image === undefined ? (
      <NoProof item={item} actions={props.actions} wide={props.wide} />
    ) : (
      <button
        type="button"
        className={cn(
          "flex min-h-0 cursor-zoom-in items-center justify-center p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !props.fit && "flex-1",
        )}
        aria-label={`Open ${image.name}`}
        onClick={() => setZoom(index)}
      >
        <img
          src={image.src ?? undefined}
          alt={image.name}
          className={cn(
            "rounded-md object-contain",
            props.fit
              ? "max-h-[42vh] w-auto max-w-full"
              : props.wide
                ? "size-full"
                : "max-h-[45vh] max-w-full",
          )}
        />
      </button>
    );

  if (!props.wide) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden rounded-xl border bg-muted/40">
        {proof}
        {item.playUrl && image !== undefined ? (
          <Button
            variant="outline"
            className="m-2 mt-0"
            render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}
          >
            <PlayIcon />
            Play
          </Button>
        ) : null}
        {zoomDialog}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-muted/40",
        props.fit && !live ? "max-h-full" : "min-h-80 flex-1",
      )}
    >
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <ToggleGroup
          aria-label="Show"
          variant="segmented"
          value={[live ? "live" : "proof"]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "live" || next === "proof")
              useReturnsStore.setState({ playing: next === "live" ? item.key : null });
          }}
        >
          <Toggle value="proof" aria-label="Proof">
            <ImageIcon className="size-3.5" />
            Proof
          </Toggle>
          {item.playUrl ? (
            <Toggle value="live" aria-label="Live">
              <PlayIcon className="size-3.5" />
              Live
            </Toggle>
          ) : null}
        </ToggleGroup>
        {item.playUrl ? <Kbd>V</Kbd> : null}
        <span className="min-w-0 flex-1 truncate text-end text-muted-foreground text-xs">
          {live ? host : images.length > 1 ? `${index + 1} of ${images.length}` : null}
        </span>
        {live && item.playUrl ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in a new tab"
            title="Open in a new tab"
            render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLinkIcon />
          </Button>
        ) : null}
      </div>
      {live && item.playUrl ? (
        isPreviewSupportedInRuntime() ? (
          <GrowPreview
            environmentId={item.thread.environmentId}
            threadId={item.thread.id}
            url={item.playUrl}
          />
        ) : (
          <GrowFrame url={item.playUrl} />
        )
      ) : (
        <>
          {proof}
          {images.length > 1 ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-t p-2">
              {images.map((candidate, index) => (
                <button
                  key={candidate.name}
                  type="button"
                  aria-label={`Show ${candidate.name}`}
                  aria-current={candidate === image ? "true" : undefined}
                  className={cn(
                    "h-14 shrink-0 overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    candidate === image ? "border-foreground" : "opacity-60 hover:opacity-100",
                  )}
                  onClick={() => setShown(index)}
                >
                  <img src={candidate.src ?? undefined} alt="" className="h-full w-auto" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      {zoomDialog}
    </div>
  );
}

/** Where the proof belongs when there is none: say so, and ask for it in one tap. */
function NoProof(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly wide: boolean;
}) {
  const { item } = props;
  const askable = item.kind === "return" || item.kind === "urgent";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        props.wide ? "min-h-0 flex-1 p-6" : "p-4",
      )}
    >
      <ImageOffIcon className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">No proof yet</span>
        <span className="text-muted-foreground text-xs">
          {item.kind === "working"
            ? "It comes with the answer."
            : "T3 asked it for one when it finished."}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {askable ? (
          <Button variant="outline" onClick={() => void props.actions.askProof(item)}>
            <ImageIcon />
            Ask again
            {props.wide ? <Kbd>A</Kbd> : null}
          </Button>
        ) : null}
        {item.playUrl ? (
          props.wide ? (
            <Button onClick={() => useReturnsStore.setState({ playing: item.key })}>
              <PlayIcon />
              Live
            </Button>
          ) : (
            <Button render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}>
              <PlayIcon />
              Play
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

/** A preview on the web, where T3's own browser is not there. */
function GrowFrame(props: { readonly url: string }) {
  const host = props.url.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  return (
    <>
      {/* Unsandboxed: previews need scripts, storage and logins, and run on their own origin. */}
      {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
      <iframe
        title={host}
        src={props.url}
        className="min-h-0 w-full flex-1 bg-white"
        allow="autoplay; fullscreen; clipboard-read; clipboard-write"
      />
    </>
  );
}

/** The main choice, What if, Settle, each saying what it does; or the way back for what is decided. */
function Choices(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly question: boolean;
  readonly whatIfOpen: boolean;
  readonly setWhatIfOpen: (open: boolean) => void;
  readonly supersedeOpen: boolean;
  readonly setSupersedeOpen: (open: boolean) => void;
  readonly relations: GrowRelations;
  readonly wide: boolean;
  /** One choice per row, for the narrow rail beside the visual. */
  readonly stacked: boolean;
  /** Answering then means the message box beside the item, not opening the thread. */
  readonly conversationShown: boolean;
}) {
  const { item, actions, wide, stacked } = props;
  const row = stacked ? "flex flex-col gap-2" : "grid grid-cols-3 gap-2";
  if (props.supersedeOpen && item.kind !== "working") {
    return (
      <SupersedeField
        item={item}
        relations={props.relations}
        onPick={(successor, note) => {
          props.setSupersedeOpen(false);
          actions.supersede(item, successor, note);
        }}
        onCancel={() => {
          props.setSupersedeOpen(false);
          // Back to the link that opened it, so the keyboard keeps its place.
          window.requestAnimationFrame(() =>
            document.querySelector<HTMLElement>("[data-supersede-link]")?.focus(),
          );
        }}
      />
    );
  }
  const supersedeLink = (
    <SupersedeLink
      wide={wide}
      settled={item.kind === "letGo" || item.kind === "shipped"}
      onClick={() => props.setSupersedeOpen(true)}
    />
  );
  if (item.kind === "working") {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <CircleDotIcon className="size-4 shrink-0 text-info" />
        An agent is on it. It comes back here when done.
      </p>
    );
  }
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
        {item.thread.supersededBy == null ? supersedeLink : null}
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
        {item.thread.supersededBy == null ? supersedeLink : null}
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
          actions.whatIf(item, text, props.question ? "reply" : "whatIf");
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
      stacked={stacked}
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
      stacked={stacked}
      onClick={() => actions.done(item)}
    />
  );
  const settle = (
    <Choice
      label="Settle"
      hint="Off the list, nothing sent"
      icon={<XIcon />}
      keyHint="X"
      wide={wide}
      stacked={stacked}
      onClick={() => actions.settle(item)}
    />
  );
  if (item.kind === "urgent") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className={row}>
          <Choice
            label="Answer"
            hint="In the thread"
            icon={<MessageSquareIcon />}
            keyHint={props.conversationShown ? undefined : "C"}
            primary
            wide={wide}
            stacked={stacked}
            onClick={() =>
              props.conversationShown ? focusConversationComposer() : actions.openThread(item)
            }
          />
          <Choice
            label="What if..."
            hint="Change it, same thread"
            icon={<SparklesIcon />}
            keyHint="W"
            wide={wide}
            stacked={stacked}
            onClick={() => props.setWhatIfOpen(true)}
          />
          {settle}
        </div>
        {supersedeLink}
      </div>
    );
  }
  const primary = growPrimary(item, props.question);
  return (
    <div className="flex flex-col gap-1.5">
      <div className={row}>
        {primary === "reply" ? (
          <>
            <Choice
              label="Reply"
              hint="Answer its question"
              icon={<ReplyIcon />}
              keyHint="W"
              primary
              wide={wide}
              stacked={stacked}
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
              stacked={stacked}
              onClick={() => props.setWhatIfOpen(true)}
            />
          </>
        )}
        {settle}
      </div>
      {supersedeLink}
    </div>
  );
}

/** The quiet second way to settle: name the thread that took this one further. */
function SupersedeLink(props: {
  readonly wide: boolean;
  readonly settled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      variant="ghost-muted"
      size="compact"
      className="self-end"
      data-supersede-link=""
      onClick={props.onClick}
    >
      <LayersIcon />
      {props.settled ? "Superseded by..." : "Settle, superseded by..."}
      {props.wide ? <Kbd>Shift X</Kbd> : null}
    </Button>
  );
}

/**
 * Pick the thread that superseded this one (related threads first, a search
 * for the rest) and say in one line why and what carried over. Arrows move
 * through the list, Enter picks, Escape goes back to the choices.
 */
function SupersedeField(props: {
  readonly item: GrowReturn;
  readonly relations: GrowRelations;
  readonly onPick: (successor: EnvironmentThreadShell, note: string) => void;
  readonly onCancel: () => void;
}) {
  const { item } = props;
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  // -1 until the user picks: Settle must never take a thread nobody chose.
  const [index, setIndex] = useState(-1);
  const projectTitle = useProjectTitle();
  const candidates = useMemo(
    () =>
      supersedeCandidates({
        thread: item.thread,
        relations: props.relations,
        parentKey: growParentKey(item.thread, item.card),
        query,
      }),
    [item.card, item.thread, props.relations, query],
  );
  const chosen = index < 0 ? undefined : candidates[Math.min(index, candidates.length - 1)];
  const pick = () => {
    if (chosen !== undefined) props.onPick(chosen, note.trim());
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((at) => Math.max(0, Math.min(candidates.length - 1, at < 0 ? 0 : at + step)));
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={`Superseded by, for ${item.headline}`}
      onSubmit={(event) => {
        event.preventDefault();
        pick();
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          nativeInput
          autoFocus
          type="text"
          size="lg"
          aria-label="Find the thread that superseded it"
          placeholder="Superseded by which thread?"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </InputGroup>
      <ul role="listbox" aria-label="Threads" className="flex flex-col gap-0.5">
        {candidates.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground text-sm">No thread matches</li>
        ) : (
          candidates.map((candidate) => (
            <li key={candidate.id} role="option" aria-selected={candidate === chosen}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-sm ring-inset",
                  candidate === chosen
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/60"
                    : "hover:bg-accent/50",
                )}
                onClick={() => setIndex(candidates.indexOf(candidate))}
              >
                {candidate === chosen ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{cleanLabel(candidate.title)}</span>
                <span className="max-w-40 shrink-0 truncate text-muted-foreground text-xs">
                  {[
                    projectTitle(candidate),
                    candidate.settledAt === null ? null : "settled",
                    formatRelativeTimeLabel(candidate.updatedAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      <InputGroup>
        <InputGroupAddon>
          <LayersIcon />
        </InputGroupAddon>
        <InputGroupInput
          nativeInput
          type="text"
          size="lg"
          maxLength={280}
          aria-label="Why, and what carried over"
          placeholder="Why, and what carried over (one line)"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </InputGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={chosen === undefined}>
          {item.kind === "letGo" || item.kind === "shipped" ? "Link" : "Settle"}
        </Button>
      </div>
    </form>
  );
}

function Choice(props: {
  readonly label: string;
  readonly hint: string;
  readonly icon: ReactNode;
  readonly keyHint: string | undefined;
  readonly primary?: boolean;
  readonly wide: boolean;
  readonly stacked: boolean;
  readonly onClick: () => void;
}) {
  if (props.stacked) {
    return (
      <Button
        variant={props.primary ? "default" : "outline"}
        size="lg"
        className="justify-start"
        onClick={props.onClick}
      >
        {props.icon}
        {props.label}
        <span className="ms-auto truncate font-normal text-xs opacity-70">{props.hint}</span>
        {props.wide && props.keyHint ? <Kbd>{props.keyHint}</Kbd> : null}
      </Button>
    );
  }
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1">
      <Button
        variant={props.primary ? "default" : "outline"}
        size={props.wide ? "lg" : "xl"}
        onClick={props.onClick}
      >
        {props.icon}
        {props.label}
        {props.wide && props.keyHint ? <Kbd className="max-sm:hidden">{props.keyHint}</Kbd> : null}
      </Button>
      <span className="text-balance text-center text-muted-foreground text-xs">{props.hint}</span>
    </div>
  );
}

/** The message box of the conversation shown beside the item. */
function focusConversationComposer() {
  document.querySelector<HTMLElement>('[data-grow-conversation] [contenteditable="true"]')?.focus();
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
            One you settled
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
