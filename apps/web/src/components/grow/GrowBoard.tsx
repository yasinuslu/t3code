/**
 * The Grow board: every thread is a card moving through the owner's loop,
 * idea to playable thing to learning to the regroup decision to built on
 * main. Stages come from the thread itself unless someone set one (the
 * manager or an agent through `grow_update`, or the user here).
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon, PlayIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useGrowCards } from "../../state/grow";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ThreadReportBody, WORK_REASON_LOOK, useThreadReport } from "../home/ThreadReportCard";
import { Badge } from "../ui/badge";
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
  type GrowBoardCard,
  buildGrowBoard,
  growRailOrder,
} from "./grow.logic";
import { GrowFocus } from "./GrowFocus";
import { SavedField, StageActions, type UpdateCard, useGrowUpdate } from "./GrowParts";
import { useGrowFocusStore } from "./grow.store";
import { useGrowShortcuts } from "./useGrowShortcuts";

export function GrowBoard(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly now: number;
}) {
  const cards = useGrowCards();
  const board = useMemo(
    () => buildGrowBoard(props.threads, cards, props.now),
    [cards, props.now, props.threads],
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const update = useGrowUpdate();
  // Wide windows focus a card in place; narrow ones keep the detail dialog.
  const wide = useMediaQuery("lg");
  const focusedKey = useGrowFocusStore((store) => store.focusedKey);
  const setFocusedKey = useGrowFocusStore((store) => store.setFocusedKey);
  const focusedCard = useMemo(
    () => growRailOrder(board).find((card) => card.key === focusedKey) ?? null,
    [board, focusedKey],
  );
  useGrowShortcuts(board, { enabled: wide, canPlay: focusedCard?.playUrl != null });
  const choose = (key: string) => (wide ? setFocusedKey(key) : setOpenKey(key));
  const open =
    openKey === null
      ? null
      : (Object.values(board)
          .flat()
          .find((card) => card.key === openKey) ?? null);

  if (wide && focusedKey !== null) {
    return <GrowFocus board={board} focusedKey={focusedKey} update={update} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4" data-grow-board="">
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
        {GROW_COLUMN_STAGES.map((stage) => {
          const column = GROW_STAGE_DEFS[stage];
          return (
            <section
              key={stage}
              aria-label={column.title}
              data-grow-column={stage}
              className={cn(
                "flex min-h-0 w-68 min-w-68 flex-1 flex-col gap-2 rounded-xl border p-2",
                column.yourTurn ? "border-warning/50 bg-warning-surface/40" : "bg-card/40",
              )}
            >
              <h2 className="flex items-baseline gap-2 px-1 font-medium text-sm">
                <span className={column.yourTurn ? "text-warning-foreground" : undefined}>
                  {column.title}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {board[stage].length}
                </span>
              </h2>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {board[stage].length === 0 ? (
                  <p className="px-1 text-muted-foreground text-xs">{column.empty}</p>
                ) : (
                  board[stage].map((card) => (
                    <GrowCardView
                      key={card.key}
                      card={card}
                      now={props.now}
                      onOpen={() => choose(card.key)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      <section
        aria-label={GROW_STAGE_DEFS.shelved.title}
        data-grow-column="shelved"
        className="shrink-0 px-1"
      >
        <h2 className="mb-1 flex items-baseline gap-2 font-medium text-sm">
          Shelf
          <span className="text-muted-foreground text-xs tabular-nums">{board.shelved.length}</span>
        </h2>
        {board.shelved.length === 0 ? (
          <p className="text-muted-foreground text-xs">{GROW_STAGE_DEFS.shelved.empty}</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {board.shelved.map((card) => (
              <Button
                key={card.key}
                size="sm"
                variant="outline"
                className="max-w-60"
                onClick={() => choose(card.key)}
              >
                <span className="truncate">{card.thread.title}</span>
              </Button>
            ))}
          </div>
        )}
      </section>
      {open ? (
        <GrowCardDialog card={open} update={update} onClose={() => setOpenKey(null)} />
      ) : null}
    </div>
  );
}

function GrowCardView(props: {
  readonly card: GrowBoardCard;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const { card } = props;
  const lessons = card.card?.lessons.length ?? 0;
  const pullRequest = card.thread.pullRequests.find(
    (candidate) => candidate.source !== "stack-dismissed",
  );
  return (
    <article
      className="relative flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-card-foreground"
      data-grow-card={card.thread.id}
    >
      <button
        type="button"
        className="min-w-0 text-start font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
        onClick={props.onOpen}
      >
        <span className="line-clamp-2">{card.thread.title}</span>
      </button>
      {card.card?.became ? (
        <p className="line-clamp-2 text-muted-foreground text-xs">{card.card.became}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {card.reason !== "settled" ? (
          <Badge variant="outline" size="sm">
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", WORK_REASON_LOOK[card.reason].dot)}
            />
            {WORK_REASON_LOOK[card.reason].label}
          </Badge>
        ) : null}
        {lessons > 0 ? (
          <Badge variant="secondary" size="sm">
            {lessons === 1 ? "1 lesson" : `${lessons} lessons`}
          </Badge>
        ) : null}
        {pullRequest ? (
          <Badge variant="outline" size="sm">
            #{pullRequest.number}
            {pullRequest.snapshot ? ` ${pullRequest.snapshot.state}` : ""}
          </Badge>
        ) : null}
        <span className="ms-auto text-muted-foreground text-xs tabular-nums">
          {formatRelativeTimeLabel(card.lastActivityAt)}
        </span>
      </div>
      {card.playUrl ? (
        <Button
          size="xs"
          className="relative z-10 self-start"
          variant={card.stage === "play" ? "default" : "outline"}
          render={<a href={card.playUrl} target="_blank" rel="noopener noreferrer" />}
        >
          <PlayIcon />
          Play
        </Button>
      ) : null}
    </article>
  );
}

function GrowCardDialog(props: {
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
