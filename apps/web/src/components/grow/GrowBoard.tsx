/**
 * The Grow board: every thread is a card moving through the owner's loop,
 * idea to playable thing to learning to the regroup decision to built on
 * main. Stages come from the thread itself unless someone set one (the
 * manager or an agent through `grow_update`, or the user here).
 */
import { Link } from "@tanstack/react-router";
import type { GrowStage } from "@t3tools/contracts";
import { MessagesSquareIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useRememberedScroll } from "../../appMode";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { ThreadReportBody, useThreadReport } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  GROW_COLUMN_STAGES,
  GROW_STAGE_DEFS,
  type GrowBoard,
  type GrowBoardCard,
} from "./grow.logic";
import { GrowNavSkeleton, GrowRow, StageHeader, useGrowNav } from "./GrowNav";
import { SavedField, StageActions, type UpdateCard } from "./GrowParts";

/**
 * The kanban columns and the Shelf; `header` sits above them (the switch, the
 * manager). With `nav` this is the navigation zone of Board mode: arrows, h/j/k/l
 * and the other keys act on the selected card (see GrowNav).
 */
export function GrowColumns(props: {
  readonly board: GrowBoard;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  /** Wide windows: a card's Play opens its prototype in Threads mode. */
  readonly onPlay?: (key: string) => void;
  readonly header?: ReactNode;
  /** False until the cards have loaded; the columns are not drawn before. */
  readonly ready?: boolean;
  readonly canPlay?: boolean;
  /** Shown instead of the columns when a search hides every card. */
  readonly empty?: ReactNode;
}) {
  const { board, selected } = props;
  const boardScrollRef = useRememberedScroll("grow:board");
  const phone = useIsMobile();
  const nav = useGrowNav<HTMLDivElement>({
    mode: "board",
    board,
    selected: selected ?? "",
    canPlay: props.canPlay ?? false,
    enabled: selected !== null,
    ready: props.ready !== false,
  });
  return (
    <div
      ref={nav.ref}
      onKeyDown={nav.onKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-2 pb-4"
      data-grow-board=""
      data-grow-zone=""
    >
      {props.header}
      {props.ready === false ? (
        <GrowNavSkeleton />
      ) : props.empty ? (
        props.empty
      ) : phone ? (
        <PhoneColumns board={board} selected={selected} onSelect={props.onSelect} />
      ) : (
        <>
          {/* One row, every stage with Shelf last; the columns share the width and only
              scroll sideways when they cannot fit, with the scrollbar at the board's edge. */}
          <div
            ref={boardScrollRef}
            className="flex min-h-0 flex-1 gap-2 overflow-x-auto scroll-px-3 pb-1"
          >
            {[...GROW_COLUMN_STAGES, "shelved" as const].map((stage) => {
              const column = GROW_STAGE_DEFS[stage];
              return (
                <section
                  key={stage}
                  aria-label={column.title}
                  data-grow-column={stage}
                  className={cn(
                    "flex min-h-0 min-w-44 flex-1 basis-0 flex-col gap-2 rounded-xl border p-1.5",
                    column.yourTurn ? "border-warning/50 bg-warning-surface/40" : "bg-card/40",
                  )}
                >
                  <StageHeader stage={stage} count={board[stage].length} />
                  <BoardColumnList
                    stage={stage}
                    className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden"
                  >
                    {board[stage].length === 0 ? (
                      <p className="px-1 text-muted-foreground text-xs">{column.empty}</p>
                    ) : (
                      board[stage].map((card) => (
                        <GrowRow
                          key={card.key}
                          card={card}
                          variant="card"
                          selected={card.key === selected}
                          onSelect={props.onSelect}
                          {...(props.onPlay ? { onPlay: props.onPlay } : {})}
                        />
                      ))
                    )}
                  </BoardColumnList>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const PHONE_STAGES: ReadonlyArray<GrowStage> = [...GROW_COLUMN_STAGES, "shelved"];

/** The stage a phone opens on: the first one waiting on you, else the first with cards. */
function phoneDefaultStage(board: GrowBoard): GrowStage {
  return (
    PHONE_STAGES.find((stage) => GROW_STAGE_DEFS[stage].yourTurn && board[stage].length > 0) ??
    PHONE_STAGES.find((stage) => board[stage].length > 0) ??
    PHONE_STAGES[0] ??
    "idea"
  );
}

/**
 * Phones show one stage at a time under a strip of stage tabs: five columns
 * side by side would scroll the stage that is waiting on you off screen.
 */
function PhoneColumns(props: {
  readonly board: GrowBoard;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
}) {
  const { board } = props;
  const [chosen, setChosen] = useState<GrowStage | null>(null);
  const stage = chosen ?? phoneDefaultStage(board);
  const column = GROW_STAGE_DEFS[stage];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-grow-phone-columns="">
      <div
        role="tablist"
        aria-label="Stages"
        className="-mx-(--workspace-gutter-start) flex shrink-0 snap-x scroll-px-(--workspace-gutter-start) gap-1.5 overflow-x-auto px-(--workspace-gutter-start) [scrollbar-width:none]"
      >
        {PHONE_STAGES.map((candidate) => {
          const def = GROW_STAGE_DEFS[candidate];
          const active = candidate === stage;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={active}
              data-grow-stage-tab={candidate}
              className={cn(
                "flex h-10 shrink-0 snap-start touch-manipulation items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors active:bg-accent",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : def.yourTurn
                    ? "border-warning/50 text-warning-foreground"
                    : "text-muted-foreground",
              )}
              onClick={() => setChosen(candidate)}
            >
              {def.title}
              <span className="tabular-nums opacity-70">{board[candidate].length}</span>
            </button>
          );
        })}
      </div>
      <section
        aria-label={column.title}
        data-grow-column={stage}
        className={cn(
          "flex min-h-0 flex-1 flex-col rounded-xl border p-1.5",
          column.yourTurn ? "border-warning/50 bg-warning-surface/40" : "bg-card/40",
        )}
      >
        <BoardColumnList
          key={stage}
          stage={stage}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden"
        >
          {board[stage].length === 0 ? (
            <p className="px-1 py-2 text-muted-foreground text-sm">{column.empty}</p>
          ) : (
            board[stage].map((card) => (
              <GrowRow
                key={card.key}
                card={card}
                variant="card"
                selected={card.key === props.selected}
                onSelect={props.onSelect}
              />
            ))
          )}
        </BoardColumnList>
      </section>
    </div>
  );
}

/** One stage's scrolling list; remembers where it was scrolled while Home is closed. */
function BoardColumnList(props: {
  readonly stage: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const ref = useRememberedScroll(`grow:column:${props.stage}`);
  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  );
}

export function GrowCardDialog(props: {
  readonly card: GrowBoardCard;
  readonly update: UpdateCard;
  readonly onClose: () => void;
}) {
  const { card, update } = props;
  const { thread } = card;
  const { digest } = useThreadReport(thread);
  const stored = card.card;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{thread.title}</DialogTitle>
          <DialogDescription>{GROW_STAGE_DEFS[card.stage].title}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4" data-grow-detail={thread.id}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId: thread.environmentId, threadId: thread.id }}
                  />
                }
              >
                <MessagesSquareIcon />
                Open thread
              </Button>
              {card.playUrl ? (
                <Button
                  size="sm"
                  render={<a href={card.playUrl} target="_blank" rel="noopener noreferrer" />}
                >
                  <PlayIcon />
                  Play
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
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
            </div>
            <StageActions card={card} update={update} />
            <ThreadReportBody
              environmentId={thread.environmentId}
              threadId={thread.id}
              digest={digest}
            />
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
