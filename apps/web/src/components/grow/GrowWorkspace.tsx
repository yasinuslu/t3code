/**
 * Grow, Home's workspace: the left side is always the threads, either as a
 * rail (Threads mode: rail, the selected thread's chat, and the thing it made)
 * or grown into the kanban board (Board mode: board, and the chat). The chat
 * always shows the selection: a card, or the manager. Below \`lg\` only the
 * board shows, with the card dialog.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { type ReactNode, useMemo, useState } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { useGrowCards } from "../../state/grow";
import ChatView from "../ChatView";
import { GrowCardDialog, GrowColumns } from "./GrowBoard";
import { LeftSwitch, ManagerButton, Rail, Thing } from "./GrowFocus";
import { useGrowUpdate } from "./GrowParts";
import {
  GROW_MANAGER_KEY,
  buildGrowBoard,
  growEffectiveSelection,
  growRailOrder,
} from "./grow.logic";
import { useGrowStore } from "./grow.store";
import { useGrowShortcuts } from "./useGrowShortcuts";

export function GrowWorkspace(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
  /** The manager's chat, as Home docks it. */
  readonly managerPane: ReactNode;
}) {
  const cards = useGrowCards();
  const board = useMemo(
    () => buildGrowBoard(props.threads, cards, props.now),
    [cards, props.now, props.threads],
  );
  const wide = useMediaQuery("lg");
  const leftMode = useGrowStore((store) => store.leftMode);
  const storedSelection = useGrowStore((store) => store.selected);
  const select = useGrowStore((store) => store.select);
  const play = useGrowStore((store) => store.play);
  const update = useGrowUpdate();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const selected = growEffectiveSelection(board, storedSelection);
  const rail = useMemo(() => growRailOrder(board), [board]);
  const selectedCard = rail.find((card) => card.key === selected) ?? null;
  useGrowShortcuts(board, { enabled: wide, canPlay: selectedCard?.playUrl != null });

  if (!wide) {
    const open = rail.find((card) => card.key === openKey) ?? null;
    return (
      <div className="flex min-h-0 flex-1 flex-col px-(--workspace-gutter-start) pt-3">
        <GrowColumns board={board} now={props.now} selected={null} onSelect={setOpenKey} />
        {open ? (
          <GrowCardDialog card={open} update={update} onClose={() => setOpenKey(null)} />
        ) : null}
      </div>
    );
  }

  const chat = (
    <div className="flex min-h-0 min-w-0 flex-col">
      {selectedCard ? (
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
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(22rem,32%)]"
        data-grow-mode="board"
      >
        <div className="flex min-h-0 min-w-0 flex-col ps-(--workspace-gutter-start) pt-3 pe-3">
          <GrowColumns
            board={board}
            now={props.now}
            selected={selected === GROW_MANAGER_KEY ? null : selected}
            onSelect={select}
            onPlay={play}
            header={
              <div className="flex flex-col gap-2">
                <LeftSwitch />
                <ManagerButton selected={selected === GROW_MANAGER_KEY} />
              </div>
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
          ? "grid-cols-[auto_minmax(22rem,1fr)_minmax(0,1.3fr)]"
          : "grid-cols-[auto_minmax(0,1fr)]",
      )}
      data-grow-mode="threads"
    >
      <div className="flex min-h-0 flex-col ps-(--workspace-gutter-start) pt-3">
        <Rail board={board} selected={selected} />
      </div>
      {chat}
      {selectedCard ? <Thing key={selectedCard.key} card={selectedCard} update={update} /> : null}
    </div>
  );
}
