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
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { useEveryManagerThreadKey } from "../../brainstormStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { useGrowCards, useGrowLoaded } from "../../state/grow";
import ChatView from "../ChatView";
import { GrowCardDialog, GrowColumns } from "./GrowBoard";
import { Rail, Thing } from "./GrowFocus";
import { GrowHeader, ManagerRow, focusSelectedRow } from "./GrowNav";
import { useGrowUpdate } from "./GrowParts";
import {
  GROW_MANAGER_KEY,
  buildGrowBoard,
  growBoardProjects,
  growEffectiveSelection,
  growRailOrder,
} from "./grow.logic";
import { useGrowStore } from "./grow.store";

/**
 * Esc inside a chat's composer goes back to the list, unless the composer or a
 * popup used it itself. Listens on the document in the bubble phase: after the
 * composer's own handling (so `defaultPrevented` says it was used) and before
 * Home's window listener, which would close Home.
 */
function returnToList(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-grow-chat] [data-testid="composer-editor"]') == null) return;
  const popup = [
    ...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ].some((element) => element.closest("[inert]") === null);
  if (popup) return;
  event.preventDefault();
  event.stopPropagation();
  focusSelectedRow(document.querySelector<HTMLElement>("[data-grow-zone]"));
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
  const wide = useMediaQuery("lg");
  useEffect(() => {
    if (!wide) return;
    document.addEventListener("keydown", returnToList);
    return () => document.removeEventListener("keydown", returnToList);
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
        <GrowColumns board={board} selected={null} onSelect={setOpenKey} ready={ready} />
        {open ? (
          <GrowCardDialog card={open} update={update} onClose={() => setOpenKey(null)} />
        ) : null}
      </div>
    );
  }

  const chat = (
    <div className="flex min-h-0 min-w-0 flex-col" data-grow-chat="">
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
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,28%)]"
        data-grow-mode="board"
      >
        <div className="flex min-h-0 min-w-0 flex-col ps-(--workspace-gutter-start) pt-3 pe-3">
          <GrowColumns
            board={board}
            selected={selected}
            onSelect={select}
            onPlay={play}
            ready={ready}
            canPlay={canPlay}
            header={
              <>
                <GrowHeader projects={projects} />
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
          ? "grid-cols-[auto_minmax(20rem,0.9fr)_minmax(0,1.6fr)]"
          : "grid-cols-[auto_minmax(0,1fr)]",
      )}
      data-grow-mode="threads"
    >
      <div className="flex min-h-0 flex-col ps-(--workspace-gutter-start) pt-3">
        <Rail
          board={board}
          selected={selected}
          projects={projects}
          ready={ready}
          canPlay={canPlay}
        />
      </div>
      {chat}
      {selectedCard ? <Thing key={selectedCard.key} card={selectedCard} update={update} /> : null}
    </div>
  );
}
