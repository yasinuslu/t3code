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
 * user asked from here, as typed requests on the thread itself.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { WidgetThreadFacts } from "../../widgetFrame/protocol";
import {
  ComposerContextId,
  type EnvironmentId,
  type GrowDecision,
  type GrowRequestKind,
  type ScopedThreadRef,
  type ThreadGrowRequest,
  type ThreadId,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
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
  ListChecksIcon,
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
  useCallback,
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
import { ManagerMachineSwitcher } from "../brainstorm/ManagerMachineSwitcher";
import { useEnsureManagerThread } from "../brainstorm/useOpenManagerThread";
import { Badge } from "../ui/badge";
import { growIsHome, useHomeOverlayStore } from "../../homeOverlayStore";
import { openFullView, setGrowOnScreen, useGrowFocusStore } from "../../growFocus";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useStackedLayout } from "../../hooks/useStackedLayout";
import { cn, newMessageId, randomUUID } from "../../lib/utils";
import { useSidebarThreadRowSlot } from "../../sidebarThreadRowSlot";
import { readThreadShell, useProjects, useThreadShell } from "../../state/entities";
import { growEnvironment, useGrowCards, useGrowLoaded } from "../../state/grow";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatView from "../ChatView";
import { type GrowZone, growKeyAction } from "./grow.keys";
import { activeZone, focusZone, installZoneMemory, reloadLive, zoneOf } from "./grow.zones";
import { stepProfile } from "../ProfileShortcuts";
import { useShortcutsSheetOpen } from "../ShortcutsSheet";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { WORK_REASON_LOOK, useReportImages, useThreadReport } from "../home/ThreadReportCard";
import {
  markOverlay,
  type PresentationVersions,
  SlideStrip,
  SlideView,
  usePresentationVersion,
  useSlides,
  VersionStepper,
} from "./GrowPresentation";
import type { Slide } from "./presentation.logic";
import { Button } from "../ui/button";
import { StartPreviewButton, StopPreviewButton } from "./PreviewEnvironment";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { readEnvironmentSupportsSettlement } from "../../state/entities";
import { decide, undo, usePendingDecisions } from "./grow.decide";
import { GrowDetails } from "./GrowDetails";
import { GrowPreview } from "./GrowPreview";
import {
  type GrowDeck,
  type GrowRelations,
  type GrowReturn,
  buildGrowDeck,
  buildGrowRelations,
  supersedeCandidates,
  supersededChain,
  filterGrowDeck,
  growCurrent,
  growDeckItems,
  growEntry,
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

/** Sent by A and D; the presentation on screen shows the next or previous page. */
const PROOF_IMAGE_EVENT = "grow:proof-image";

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

/** The chip a Grow request shows as in the conversation. */
const GROW_REQUEST_LABEL: Record<GrowRequestKind, string> = {
  presentation: "Presentation",
  ship: "Ship",
  change: "What if",
  reply: "Reply",
  form: "Answers",
};

/** The actions on a return, wired to the thread and its grow card. */
export function useReturnActions(moveOn: (item: GrowReturn) => void) {
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

  /** Sends a typed request: the agent reads what it asks, the thread keeps it until answered. */
  const send = async (
    item: GrowReturn,
    request: GrowRequestKind,
    words: string,
    dispatchMode?: "queue",
    id?: string,
  ) => {
    const contextId = ComposerContextId.make(id ?? `grow-${randomUUID()}`);
    const label = GROW_REQUEST_LABEL[request];
    const reference = formatComposerContextReference({ kind: "grow-request", contextId, label });
    const result = await startTurn({
      environmentId: item.thread.environmentId,
      input: {
        threadId: item.thread.id,
        ...(dispatchMode === undefined ? {} : { dispatchMode }),
        message: {
          messageId: newMessageId(),
          role: "user",
          text: words === "" ? reference : `${reference} ${words}`,
          context: {
            version: 1,
            records: [{ version: 1, contextId, kind: "grow-request", label, request }],
          },
          attachments: [],
        },
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
          if (await send(item, "ship", "")) await record(item, "adopt");
        },
      });
    },
    /**
     * Sends a reply or a change request. It is a message, not a decision: it goes at once and
     * in place, so the thread stays on screen (now working) and nothing moves on to the next.
     */
    whatIf: async (item: GrowReturn, text: string, kind: "whatIf" | "reply") => {
      const request = kind === "whatIf" ? "change" : "reply";
      if ((await send(item, request, text)) && item.card?.decision !== undefined) {
        await record(item, null);
      }
    },
    /**
     * Sends a form page's answers; the page's request id marks it answered. At once and in
     * place, with no undo window: the answered page offers Change answers instead.
     */
    answerForm: async (item: GrowReturn, requestId: string, text: string) => {
      if ((await send(item, "form", text, undefined, requestId)) && item.card?.decision) {
        await record(item, null);
      }
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
        if (await send(item, "presentation", "", "queue")) {
          toastManager.add({ type: "success", title: `Asked ${item.headline} for a presentation` });
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
  // The thread on screen gets a row even when no section lists it (settled, idle for weeks,
  // snoozed, a manager's, filtered out by the search).
  const outsideRow = useMemo(() => {
    const onScreenThread = threadShell ?? current?.thread;
    if (onScreenThread === undefined || onScreenKey === null) return null;
    if (growDeckItems(shown).some((item) => item.key === onScreenKey)) return null;
    return growEntry(onScreenThread, cards.get(onScreenKey), "return");
  }, [cards, current, onScreenKey, shown, threadShell]);
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

  // Q goes back to the place before this one: the last two places focus was in.
  const zones = useRef<GrowZone[]>([]);
  useEffect(
    () =>
      installZoneMemory((zone) => {
        const last = zones.current[0];
        if (last !== zone) zones.current = last === undefined ? [zone] : [zone, last];
      }),
    [],
  );

  useEffect(() => {
    const jump = (zone: GrowZone) => {
      const item = current;
      switch (zone) {
        case "threads":
          if (manager) hideManager();
          break;
        case "presentation":
          if (item === null) return;
          useReturnsStore.setState({ playing: null, thread: null, manager: false });
          break;
        case "live":
          if (item === null || item.playUrl === null) return;
          if (!wide) {
            window.open(item.playUrl, "_blank", "noopener");
            return;
          }
          useReturnsStore.setState({ playing: item.key, thread: null, manager: false });
          break;
        case "chat":
          if (item === null) return;
          if (!(wide && split)) actions.openThread(item);
          break;
      }
      focusZone(zone);
    };
    const onKey = (event: KeyboardEvent) => {
      // The cheat sheet, open menus and modal dialogs own the keyboard while they show. A toast
      // is a dialog too, but not a modal one.
      if (sheetOpen || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="listbox"], [aria-modal="true"]')) return;
      const action = growKeyAction(event, {
        typing: isTyping(event.target),
        inLive: zoneOf(event.target) === "live",
        managerOpen: manager,
        item: current,
      });
      if (action === null) return;
      const item = current;
      switch (action.type) {
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
        case "step": {
          // The place focus is in stays: live stays live, the chat stays the chat.
          const zone = activeZone();
          const next = growStep(shown, item?.key ?? null, action.direction);
          select(next);
          const nextItem = growDeckItems(shown).find((candidate) => candidate.key === next);
          if (playing !== null && nextItem?.playUrl) useReturnsStore.setState({ playing: next });
          // After the next item renders, or focus lands on the row or page it replaces.
          const stay = zone === "live" && !nextItem?.playUrl ? "presentation" : zone;
          if (stay !== null)
            requestAnimationFrame(() => requestAnimationFrame(() => focusZone(stay)));
          break;
        }
        case "page":
          if (playing !== null) jump("presentation");
          window.dispatchEvent(new CustomEvent(PROOF_IMAGE_EVENT, { detail: action.direction }));
          break;
        case "zone":
          jump(action.zone);
          break;
        case "back": {
          const here = activeZone();
          const before = zones.current.find((zone) => zone !== here);
          if (before === undefined) return;
          jump(before);
          break;
        }
        case "undo":
          if (!undo()) return;
          break;
        case "search":
          document.querySelector<HTMLElement>("[data-grow-search]")?.focus();
          break;
        case "main":
          if (item === null) return;
          if (item.shippable) actions.ship(item);
          else actions.done(item);
          break;
        case "settle":
          if (item !== null) actions.settle(item);
          break;
        case "supersede":
          setWhatIfOpen(false);
          setSupersedeOpen(true);
          break;
        case "reload":
          reloadLive();
          break;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture, so a key held with Alt reaches Grow before the composer or a field takes it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [actions, current, manager, playing, query, sheetOpen, shown, split, wide]);

  // The desktop catches Grow's Alt keys inside the live app, whose page swallows every key,
  // and hands them here as the same key press.
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        const [, code, shift] = /^grow-key:(\w+):([01])$/.exec(action) ?? [];
        if (code === undefined) return;
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code, altKey: true, shiftKey: shift === "1" }),
        );
      }),
    [],
  );
  // A presentation's own page does the same from its sandboxed frame (see withGrowKeys).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type !== "t3-grow-key" || !("code" in data) || typeof data.code !== "string") return;
      const fromPage = [
        ...document.querySelectorAll<HTMLIFrameElement>('[data-grow-zone="presentation"] iframe'),
      ].some((frame) => frame.contentWindow === event.source);
      if (!fromPage) return;
      const shiftKey = "shift" in data && data.shift === true;
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: data.code, altKey: true, shiftKey }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
            <ReturnsList
              deck={shown}
              current={onScreenKey}
              outside={outsideRow}
              managerOpen={manager}
            />
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
        data-grow-zone="threads"
      >
        {header}
        <ReturnsList
          deck={shown}
          current={onScreenKey}
          outside={outsideRow}
          managerOpen={manager}
        />
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

/**
 * What is being worked on, the queue by project, then the older ones, what shipped and what was
 * settled (folded). The thread on screen is always in it: its section opens when it holds it, a
 * section the user folds still shows its row, and one the list leaves out gets an Open row.
 */
function ReturnsList(props: {
  readonly deck: GrowDeck;
  /** The thread on screen, whether or not the deck holds it. */
  readonly current: string | null;
  /** The thread on screen, when no section of the deck lists it. */
  readonly outside: GrowReturn | null;
  readonly managerOpen: boolean;
}) {
  const { deck } = props;
  const projectTitle = useProjectTitle();
  // Searching opens every group that has a match, folded sections too; clearing the search
  // returns to the focused project only (or what Expand all holds).
  const searching = useReturnsStore((state) => state.query.trim() !== "");
  const expandAll = useReturnsStore((state) => state.expandAll) || searching;
  // A section opens while it holds the item on screen (and folded ones while searching), so the
  // current row stays visible as W and S step through it. If the user folds it again, its header
  // still carries that row.
  const holding = (items: ReadonlyArray<GrowReturn>, folded = false) => {
    const held = items.find((item) => item.key === props.current);
    return {
      ...(held !== undefined || (folded && searching)
        ? { open: true, resetOn: props.current }
        : {}),
      held: held === undefined ? undefined : row(held),
    };
  };
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
  const row = (item: GrowReturn, showProject = listMode === "recent") => (
    <ReturnRow
      key={item.key}
      item={item}
      current={item.key === props.current}
      showProject={showProject}
    />
  );
  // The open thread scrolls into view when it changes, even from a folded section's header.
  const listRef = useRef<HTMLElement>(null);
  const currentKey = props.current;
  useEffect(() => {
    if (currentKey === null) return;
    listRef.current
      ?.querySelector('[aria-current]:not([aria-current="false"])')
      ?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);
  return (
    <nav
      ref={listRef}
      aria-label="Returns"
      className="@container -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-6"
    >
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
      {props.outside !== null ? (
        <ListSection title="Open" open resetOn={props.current} held={row(props.outside)}>
          {row(props.outside)}
        </ListSection>
      ) : null}
      {deck.pinned.length > 0 ? (
        <ListSection title={`Pinned (${deck.pinned.length})`} {...holding(deck.pinned)}>
          {deck.pinned.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.working.length > 0 ? (
        <ListSection title="Working" {...holding(deck.working)}>
          {deck.working.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.urgent.length > 0 ? (
        <ListSection title="Needs you now" tone="warning" {...holding(deck.urgent)}>
          {deck.urgent.map((item) => row(item))}
        </ListSection>
      ) : null}
      {listMode === "recent" ? (
        deck.returns.length > 0 ? (
          <ListSection title={`Recent (${deck.returns.length})`} {...holding(deck.returns)}>
            {deck.returns.map((item) => row(item))}
          </ListSection>
        ) : null
      ) : (
        groups.map(([key, group]) => (
          <ListSection
            key={key}
            title={`${group.title} (${group.items.length})`}
            open={growProjectOpen(key, focused, expandAll)}
            resetOn={props.current}
            held={holding(group.items).held}
          >
            {group.items.map((item) => row(item))}
          </ListSection>
        ))
      )}
      {deck.older.length > 0 ? (
        <ListSection title={`Earlier (${deck.older.length})`} folded {...holding(deck.older, true)}>
          {deck.older.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.shipped.length > 0 ? (
        <ListSection
          title={`Done this week (${deck.shipped.length})`}
          folded
          {...holding(deck.shipped, true)}
        >
          {deck.shipped.map((item) => row(item))}
        </ListSection>
      ) : null}
      {deck.letGo.length > 0 ? (
        <ListSection title={`Settled (${deck.letGo.length})`} folded {...holding(deck.letGo, true)}>
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
  /** The row of the item on screen, which stays under the header while the section is folded. */
  readonly held?: ReactNode;
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
      {open ? (
        <ul className="flex flex-col gap-0.5">{props.children}</ul>
      ) : props.held ? (
        <ul className="flex flex-col gap-0.5">{props.held}</ul>
      ) : null}
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
  const projectTitle = useProjectTitle();
  if (sidebarRow) {
    return sidebarRow(item.thread, {
      isActive: props.current,
      onSelect: () => select(item.key),
      // One mark at rest: the state. The proof mark waits for hover; the item shows the proof itself.
      mark: <RowMark item={item} />,
      subtitle: rowMeta(item, props.showProject, props.current, projectTitle),
      details: <ProofMark item={item} />,
    });
  }
  return <OwnReturnRow {...props} />;
}

/** The quiet line under a title: the project when the list is not grouped by it, the branch when shown. */
function rowMeta(
  item: GrowReturn,
  showProject: boolean,
  current: boolean,
  projectTitle: (thread: EnvironmentThreadShell) => string,
): string | null {
  const meta = [showProject ? projectTitle(item.thread) : null, current ? item.thread.branch : null]
    .filter(Boolean)
    .join(" · ");
  return meta.length > 0 ? meta : null;
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
  const meta = rowMeta(item, props.showProject, props.current, projectTitle);
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
    const look = item.reason ? REASON_LOOK[item.reason] : null;
    return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", look?.dot)} />;
  }
  if (item.playUrl !== null) {
    return <PlayIcon aria-label="Playable" className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <span aria-hidden className="size-3.5 shrink-0" />;
}

/** Whether the item came back with something to see; nothing while it is still being worked on. */
function ProofMark(props: { readonly item: GrowReturn }) {
  if (props.item.kind === "working") return null;
  return props.item.thread.presentationPages || props.item.thread.statusProof ? (
    <ImageIcon aria-label="Has a presentation" className="size-3.5 shrink-0 text-success" />
  ) : (
    <ImageOffIcon aria-label="No presentation" className="size-3.5 shrink-0 text-warning" />
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
          <span className="min-w-0 shrink truncate text-muted-foreground text-sm">{profile}</span>
        ) : null}
        {/* Each machine that runs this profile's manager has its own; pick whose to talk to. */}
        <ManagerMachineSwitcher className="shrink-0" />
        <span className="flex-1" />
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
      data-grow-zone="chat"
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
      data-grow-zone="chat"
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
  const stackedLayout = useStackedLayout();
  const { digest, presentation, growRequests } = useThreadReport(item.thread);
  const images = useReportImages(item.thread.environmentId, item.thread.id, digest.screenshots);
  const { presentation: shown, versions } = usePresentationVersion(
    item.thread.environmentId,
    item.key,
    presentation,
  );
  const slides = useSlides(item.thread.environmentId, shown, images, versions.version);
  const question = digest.questions[0] ?? null;
  const visual = (
    <Visual
      key={item.key}
      item={item}
      actions={actions}
      wide={wide}
      playing={props.playing}
      slides={slides}
      versions={versions}
      requests={growRequests}
      head={<StoryHead item={item} digest={digest} />}
      story={
        <StoryBody
          item={item}
          actions={actions}
          conversationShown={wide && props.split}
          relations={props.relations}
          open={props.open}
          digest={digest}
          requests={growRequests}
        />
      }
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
  if (!wide) {
    return (
      <article aria-label={item.headline} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-4">
          {visual}
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
        className="flex min-h-0 flex-1 flex-col outline-none"
        data-grow-zone="presentation"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-5" data-pane="proof">
          {visual}
        </div>
        <div className="shrink-0 border-t p-4">{choices(false)}</div>
      </article>
    );
  }
  // The conversation beside the thing it made (above it on a tall window), and the choices pinned under it.
  return (
    <article
      aria-label={item.headline}
      className={cn(
        "grid min-h-0 flex-1",
        stackedLayout
          ? "grid-rows-[minmax(16rem,1fr)_minmax(24rem,1.4fr)]"
          : "grid-cols-[minmax(20rem,1fr)_minmax(24rem,1.1fr)]",
      )}
    >
      <div className={cn("flex min-h-0 min-w-0 flex-col", stackedLayout ? "border-b" : "border-e")}>
        <Conversation thread={item.thread} />
      </div>
      <div
        className="flex min-h-0 min-w-0 flex-col outline-none"
        data-pane="proof"
        data-grow-zone="presentation"
      >
        <div className="flex min-h-0 flex-1 flex-col p-3">{visual}</div>
        <div className="shrink-0 border-t p-3">{choices(false)}</div>
      </div>
    </article>
  );
}

/** Why an urgent item needs the user: the thread's own reasons, plus a Grow request an agent could not do. */
const REASON_LOOK = {
  ...WORK_REASON_LOOK,
  blocked: { label: "Blocked, needs you", dot: "bg-warning" },
} as const;

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

/** The artifact's header: where it stands, what it is, and what it asks of you. */
function StoryHead(props: {
  readonly item: GrowReturn;
  readonly digest: ReturnType<typeof useThreadReport>["digest"];
}) {
  const { item, digest } = props;
  const projectTitle = useProjectTitle();
  const question = digest.questions[0] ?? null;
  const status =
    item.kind === "urgent" && item.reason
      ? REASON_LOOK[item.reason]
      : STATUS_LOOK[statusOf(item, question !== null)];
  const subtitle = cleanLabel(item.thread.title);

  return (
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
  );
}

/** The artifact's last page: where it came from and goes, and what happened. */
function StoryBody(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly relations: GrowRelations;
  readonly open: (thread: EnvironmentThreadShell) => void;
  readonly digest: ReturnType<typeof useThreadReport>["digest"];
  readonly requests: ReadonlyArray<ThreadGrowRequest>;
  /** The conversation shows beside it, so it needs no way in. */
  readonly conversationShown: boolean;
}) {
  const { item, digest } = props;
  return (
    <div className="flex flex-col gap-6">
      <StoryPath
        item={item}
        requests={props.requests}
        relations={props.relations}
        open={props.open}
      />
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
          <Kbd>4</Kbd>
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
  readonly requests: ReadonlyArray<ThreadGrowRequest>;
  readonly relations: GrowRelations;
  readonly open: (thread: EnvironmentThreadShell) => void;
}) {
  const { item, relations, requests } = props;
  const parentKey = growParentKey(item.thread, item.card);
  const parent = parentKey === null ? undefined : relations.byKey.get(parentKey);
  const children = relations.children.get(item.key) ?? [];
  const supersedes = relations.supersedes.get(item.key) ?? [];
  const supersededBy = supersededChain(relations, item.thread);
  const lastAsk = requests.at(-1);
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
        {requests.map((ask) => {
          const working = ask === lastAsk && ask.closedAt === undefined && item.kind === "working";
          return (
            <PathStep
              key={ask.id}
              icon={ASK_LOOK[ask.kind].icon}
              label={ASK_LOOK[ask.kind].label}
              active={working}
            >
              {ask.text ? <span className="italic">&ldquo;{ask.text}&rdquo;</span> : null}
              <span className="text-muted-foreground text-xs">
                {" "}
                {formatRelativeTimeLabel(ask.openedAt)}
                {working ? ", working on it" : ""}
              </span>
              {ask.outcome ? (
                <span
                  className={cn(
                    "block text-xs",
                    ask.outcome === "blocked" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {ask.outcome === "blocked" ? "Blocked" : ASK_LOOK[ask.kind].done}
                  {ask.note ? `: ${ask.note}` : ""}
                </span>
              ) : null}
            </PathStep>
          );
        })}
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
  ship: { icon: <RocketIcon />, label: "You said ship", done: "Shipped" },
  reply: { icon: <ReplyIcon />, label: "You replied", done: "Answered" },
  form: { icon: <ListChecksIcon />, label: "Your answers", done: "Answered" },
  change: { icon: <SparklesIcon />, label: "Your what if", done: "Done" },
  presentation: {
    icon: <ImageIcon />,
    label: "Asked for a presentation",
    done: "Presentation set",
  },
} as const satisfies Record<GrowRequestKind, unknown>;

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
 * The thing itself. On a wide screen one stage switches between the presentation (its pages:
 * marked images that zoom on click, short docs, interactive pages; A and D step them) and Live (the running preview, loaded only when
 * asked), with 2 and 3. Once loaded, Live stays loaded while the presentation shows, so
 * going back to it keeps the app where it was. On a phone the presentation sits above the
 * story and Play opens a tab.
 */
/** The presentation page each thread was left on, for this session. */
const shownPages = new Map<string, number>();

function Visual(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly wide: boolean;
  readonly playing: boolean;
  readonly slides: ReadonlyArray<Slide>;
  readonly versions: PresentationVersions;
  readonly requests: ReadonlyArray<ThreadGrowRequest>;
  /** On top of every page: where it stands and what it asks. */
  readonly head: ReactNode;
  /** The last page: where it came from and what happened. */
  readonly story: ReactNode;
}) {
  const { item } = props;
  const noPages = props.slides.length === 0;
  const slides = useMemo(() => [...props.slides, STORY_SLIDE], [props.slides]);
  // Coming back to a thread shows the page it was left on.
  const [shown, setShownState] = useState(() => shownPages.get(item.key) ?? 0);
  const [shownFor, setShownFor] = useState(item.key);
  if (shownFor !== item.key) {
    setShownFor(item.key);
    setShownState(shownPages.get(item.key) ?? 0);
  }
  const setShown = useCallback(
    (next: number | ((current: number) => number)) =>
      setShownState((current) => {
        const value = typeof next === "function" ? next(current) : next;
        shownPages.set(item.key, value);
        return value;
      }),
    [item.key],
  );
  // Another version reorders or swaps the pages: stay on the page being read, by its key. Story
  // alone means the pages had not loaded yet, so they open where they were left (the first).
  const [slidesSeen, setSlidesSeen] = useState(slides);
  if (slidesSeen !== slides) {
    setSlidesSeen(slides);
    const key =
      slidesSeen.length === 1 ? undefined : slidesSeen[Math.min(shown, slidesSeen.length - 1)]?.key;
    const at = key === undefined ? -1 : slides.findIndex((candidate) => candidate.key === key);
    if (at >= 0 && at !== shown) setShown(at);
  }
  const [zoom, setZoom] = useState<number | null>(null);
  const index = Math.min(shown, slides.length - 1);
  const slide = slides[index];
  const images = useMemo(
    () => slides.flatMap((candidate) => (candidate.kind === "image" ? [candidate] : [])),
    [slides],
  );
  const live = props.wide && props.playing && item.playUrl !== null;
  const [keptFor, setKeptFor] = useState<string | null>(null);
  if (live && keptFor !== item.key) setKeptFor(item.key);
  const kept = props.wide && keptFor === item.key ? item.playUrl : null;
  useEffect(() => {
    const onStep = (event: Event) => {
      const direction = event instanceof CustomEvent && event.detail === -1 ? -1 : 1;
      setShown((current) =>
        Math.max(0, Math.min(slides.length - 1, Math.min(current, slides.length - 1) + direction)),
      );
    };
    window.addEventListener(PROOF_IMAGE_EVENT, onStep);
    return () => window.removeEventListener(PROOF_IMAGE_EVENT, onStep);
  }, [setShown, slides.length]);
  const host = item.playUrl?.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  const zoomDialog =
    zoom === null ? null : (
      <ExpandedImageDialog
        preview={{
          images: images.map(({ src, name, marks }) => ({
            src,
            name,
            ...(marks.length > 0 ? { overlay: markOverlay(marks) } : {}),
          })),
          index: zoom,
        }}
        onClose={() => setZoom(null)}
      />
    );
  const threadFacts = useMemo(
    (): WidgetThreadFacts => ({
      title: item.headline,
      status: item.merged ? "merged" : (item.reason ?? item.kind),
      ...(item.pullRequest
        ? {
            pullRequest: {
              number: item.pullRequest.number,
              url: item.pullRequest.url,
              state: item.pullRequest.state ?? "open",
            },
          }
        : {}),
      ...(item.playUrl ? { previewUrl: item.playUrl } : {}),
    }),
    [item.headline, item.kind, item.merged, item.playUrl, item.pullRequest, item.reason],
  );
  const proof =
    slide === undefined ? null : (
      <SlideView
        slide={slide}
        environmentId={item.thread.environmentId}
        wide={props.wide}
        fit={!props.wide}
        story={props.story}
        onZoom={() => setZoom(images.findIndex((candidate) => candidate.key === slide.key))}
        requests={props.requests}
        onAnswer={(requestId, text) => void props.actions.answerForm(item, requestId, text)}
        readOnly={props.versions.past}
        thread={threadFacts}
      />
    );

  if (!props.wide) {
    return (
      <div className="flex shrink-0 flex-col gap-2 overflow-hidden rounded-xl border bg-muted/40">
        <div className="flex shrink-0 flex-col gap-2 border-b p-3">
          {props.head}
          {noPages ? <NoProof item={item} actions={props.actions} wide={false} /> : null}
        </div>
        {proof}
        <SlideStrip slides={slides} current={index} onPick={setShown} />
        {item.playUrl && slide !== undefined ? (
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
      className={cn("flex min-h-80 flex-1 flex-col overflow-hidden rounded-xl border bg-muted/40")}
    >
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <ToggleGroup
          aria-label="Show"
          variant="segmented"
          value={[live ? "live" : "presentation"]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "live" || next === "presentation")
              useReturnsStore.setState({ playing: next === "live" ? item.key : null });
          }}
        >
          <Toggle value="presentation" aria-label="Presentation">
            <ImageIcon className="size-3.5" />
            Presentation
          </Toggle>
          {item.playUrl ? (
            <Toggle value="live" aria-label="Live">
              <PlayIcon className="size-3.5" />
              Live
            </Toggle>
          ) : null}
        </ToggleGroup>
        {item.playUrl ? <StopPreviewButton thread={item.thread} /> : null}
        <span className="min-w-0 flex-1 truncate text-end text-muted-foreground text-xs">
          {live ? host : slides.length > 1 ? `Page ${index + 1} of ${slides.length}` : null}
        </span>
        {live ? null : <VersionStepper versions={props.versions} />}
        {item.playUrl ? null : <StartPreviewButton thread={item.thread} />}
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
      {kept ? (
        <div
          className={cn("flex min-h-0 flex-1 flex-col", !live && "hidden")}
          data-grow-zone="live"
        >
          {isPreviewSupportedInRuntime() ? (
            <GrowPreview
              environmentId={item.thread.environmentId}
              threadId={item.thread.id}
              url={kept}
              visible={live}
            />
          ) : (
            <GrowFrame url={kept} />
          )}
        </div>
      ) : null}
      {live ? null : (
        <>
          <div className="flex max-h-[40%] shrink-0 flex-col gap-2 overflow-y-auto border-b px-5 py-4">
            {props.head}
            {noPages ? <NoProof item={item} actions={props.actions} wide /> : null}
          </div>
          {proof}
          <SlideStrip slides={slides} current={index} onPick={setShown} />
        </>
      )}
      {zoomDialog}
    </div>
  );
}

const STORY_SLIDE: Slide = { kind: "story", key: "story", name: "Story" };

/** The artifact has no pages from the agent yet: say so, and ask for them in one tap. */
function NoProof(props: {
  readonly item: GrowReturn;
  readonly actions: ReturnActions;
  readonly wide: boolean;
}) {
  const { item } = props;
  const askable = item.kind === "return" || item.kind === "urgent";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <ImageOffIcon className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">
        {item.kind === "working"
          ? "No pages yet; they come with the answer."
          : "No pages from the agent yet."}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {askable ? (
          <Button variant="outline" onClick={() => void props.actions.askProof(item)}>
            <ImageIcon />
            Ask again
          </Button>
        ) : null}
        {/* Wide, Live and Start preview sit in the artifact's toolbar. */}
        {props.wide ? null : item.playUrl ? (
          <Button render={<a href={item.playUrl} target="_blank" rel="noopener noreferrer" />}>
            <PlayIcon />
            Play
          </Button>
        ) : (
          <StartPreviewButton thread={item.thread} />
        )}
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
      keyHint="E"
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
      keyHint="E"
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
            keyHint="4"
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
  readonly keyHint?: string;
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
