/**
 * Grow, Home's workspace: the left side is always the threads, either as a
 * rail (Threads mode: rail, the selected thread's chat, and the thing it made)
 * or grown into the kanban board (Board mode: board, and the chat). The chat
 * always shows the selection: a card, or the manager. Below `lg` only the
 * board shows, with the card dialog.
 *
 * Managers are never cards. Focus lives in the left side (see GrowNav); the
 * chats here never take it on their own, and Esc in a composer returns it.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";

import { useEveryManagerThreadKey } from "../../brainstormStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { useGrowCards, useGrowLoaded } from "../../state/grow";
import ChatView from "../ChatView";
import { GrowCardDialog, GrowColumns } from "./GrowBoard";
import { Rail, Thing } from "./GrowFocus";
import { GrowSplitter, growPaneVar } from "./GrowSplitter";
import { GrowHeader, ManagerRow, composerEditor, focusSelectedRow } from "./GrowNav";
import { useGrowUpdate } from "./GrowParts";
import {
  GROW_MANAGER_KEY,
  buildGrowBoard,
  filterGrowBoard,
  growBoardProjects,
  growEffectiveSelection,
  growRailOrder,
} from "./grow.logic";
import { useGrowStore } from "./grow.store";

/**
 * Esc is the one way out: with focus anywhere in Grow outside the list (a
 * composer, a field, a button in the chat or the thing), it goes back to the
 * list. An open popup or composer menu gets the first Esc. Runs in the capture
 * phase on the window so nothing inside the chat can swallow it, and before
 * Home's listener, which closes Home only once focus is back on the list.
 */
function returnToList(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const focused = document.activeElement;
  if (focused === null || focused.closest("[data-grow-mode]") === null) return;
  // The search field sits in the list's zone but Esc leaves it like any other field.
  if (
    focused.closest("[data-grow-zone]") !== null &&
    focused.closest("[data-grow-search]") === null
  ) {
    return;
  }
  const popup = [
    ...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ].some((element) => element.closest("[inert]") === null);
  if (popup) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  focusSelectedRow(document.querySelector<HTMLElement>("[data-grow-zone]"));
}

const focusThingTab = () =>
  document
    .querySelector<HTMLElement>("[data-grow-thing] [data-slot=toggle][data-pressed]")
    ?.focus({ preventScroll: true });

/**
 * Ctrl+h and Ctrl+l walk the panes, list, chat, prototype, from anywhere in
 * Grow including a composer. In the prototype pane focus rests on its tabs,
 * where h/l pick Play or Overview. Capture phase, like Esc above.
 */
function walkPanes(event: KeyboardEvent) {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey) return;
  const focused = document.activeElement;
  if (focused === null || focused.closest("[data-grow-mode]") === null) return;
  const pane =
    focused.closest("[data-grow-thing]") !== null
      ? "thing"
      : focused.closest("[data-grow-chat]") !== null
        ? "chat"
        : "list";
  const used = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (event.ctrlKey) {
    if (event.key === "h") {
      if (pane === "thing") composerEditor()?.focus();
      else focusSelectedRow(document.querySelector<HTMLElement>("[data-grow-zone]"));
      used();
    } else if (event.key === "l") {
      if (pane === "list") composerEditor()?.focus();
      else focusThingTab();
      used();
    }
    return;
  }
  if (pane !== "thing" || focused.closest("[data-slot=toggle]") === null) return;
  const tab = event.key === "h" ? "play" : event.key === "l" ? "overview" : null;
  if (tab === null) return;
  useGrowStore.getState().setThingTab(tab);
  used();
  window.requestAnimationFrame(focusThingTab);
}

export function GrowWorkspace(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
  /** The manager's chat, as Home docks it. */
  readonly managerPane: ReactNode;
}) {
  const cards = useGrowCards();
  const loaded = useGrowLoaded();
  const managers = useEveryManagerThreadKey();
  // Until the cards and the managers are known the board would flash managers as cards.
  const ready = loaded && managers.known;
  const project = useGrowStore((store) => store.project);
  const everyone = useMemo(
    () => buildGrowBoard(props.threads, cards, props.now, { excluded: managers.keys }),
    [cards, managers.keys, props.now, props.threads],
  );
  const projects = useMemo(() => growBoardProjects(everyone), [everyone]);
  const activeProject = project !== null && projects.includes(project) ? project : null;
  const board = useMemo(
    () =>
      activeProject === null
        ? everyone
        : buildGrowBoard(props.threads, cards, props.now, {
            excluded: managers.keys,
            project: activeProject,
          }),
    [activeProject, cards, everyone, managers.keys, props.now, props.threads],
  );
  // Typed in the search field; not persisted. Filters what the list shows, never the selection.
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGrowBoard(board, query), [board, query]);
  const firstShown = growRailOrder(shown)[0]?.key ?? null;
  const search = { query, setQuery, firstKey: firstShown };
  const widths = useGrowStore((store) => store.widths);
  const paneVars = {
    [growPaneVar("rail")]: `${widths.rail}px`,
    [growPaneVar("thing")]: `${widths.thing}px`,
    [growPaneVar("boardChat")]: `${widths.boardChat}px`,
  } as CSSProperties;
  const wide = useMediaQuery("lg");
  useEffect(() => {
    if (!wide) return;
    window.addEventListener("keydown", returnToList, true);
    window.addEventListener("keydown", walkPanes, true);
    return () => {
      window.removeEventListener("keydown", returnToList, true);
      window.removeEventListener("keydown", walkPanes, true);
    };
  }, [wide]);
  const leftMode = useGrowStore((store) => store.leftMode);
  const storedSelection = useGrowStore((store) => store.selected);
  const select = useGrowStore((store) => store.select);
  const play = useGrowStore((store) => store.play);
  const update = useGrowUpdate();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const selected = growEffectiveSelection(board, storedSelection);
  const rail = useMemo(() => growRailOrder(board), [board]);
  const selectedCard = ready ? (rail.find((card) => card.key === selected) ?? null) : null;
  const canPlay = selectedCard?.playUrl != null;

  if (!wide) {
    const open = rail.find((card) => card.key === openKey) ?? null;
    return (
      <div className="flex min-h-0 flex-1 flex-col px-(--workspace-gutter-start) pt-3">
        <GrowColumns board={shown} selected={null} onSelect={setOpenKey} ready={ready} />
        {open ? (
          <GrowCardDialog card={open} update={update} onClose={() => setOpenKey(null)} />
        ) : null}
      </div>
    );
  }

  const chat = (
    <div className="relative flex min-h-0 min-w-0 flex-col" data-grow-chat="">
      {leftMode === "board" ? <GrowSplitter pane="boardChat" side="start" /> : null}
      {!ready ? null : selectedCard ? (
        <section
          aria-label={`Thread: ${selectedCard.thread.title}`}
          className="flex min-h-0 min-w-0 flex-1 flex-col border-s"
        >
          <ChatView
            key={selectedCard.key}
            environmentId={selectedCard.thread.environmentId}
            threadId={selectedCard.thread.id}
            routeKind="server"
            reserveTitleBarControlInset={false}
            autoFocusComposer={false}
          />
        </section>
      ) : (
        props.managerPane
      )}
    </div>
  );

  if (leftMode === "board") {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_var(--grow-boardChat)]"
        style={paneVars}
        data-grow-mode="board"
      >
        <div className="flex min-h-0 min-w-0 flex-col ps-(--workspace-gutter-start) pt-3 pe-3">
          <GrowColumns
            board={shown}
            selected={selected}
            onSelect={select}
            onPlay={play}
            ready={ready}
            canPlay={canPlay}
            header={
              <>
                <GrowHeader projects={projects} search={search} />
                <div className="w-64">
                  <ManagerRow selected={selected === GROW_MANAGER_KEY} />
                </div>
              </>
            }
          />
        </div>
        {chat}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1",
        selectedCard
          ? "grid-cols-[var(--grow-rail)_minmax(0,1fr)_var(--grow-thing)]"
          : "grid-cols-[var(--grow-rail)_minmax(0,1fr)]",
      )}
      style={paneVars}
      data-grow-mode="threads"
    >
      <div className="relative flex min-h-0 min-w-0 flex-col ps-(--workspace-gutter-start) pt-3">
        <GrowSplitter pane="rail" side="end" />
        <Rail
          board={shown}
          search={search}
          selected={selected}
          projects={projects}
          ready={ready}
          canPlay={canPlay}
        />
      </div>
      {chat}
      {selectedCard ? (
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <GrowSplitter pane="thing" side="start" />
          <Thing key={selectedCard.key} card={selectedCard} update={update} />
        </div>
      ) : null}
    </div>
  );
}
