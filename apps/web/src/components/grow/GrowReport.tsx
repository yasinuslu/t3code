/**
 * Grow's answer to "does play work, does every thread produce something?":
 * one number in the header, and under it the threads that are stuck before
 * play, the ones that ended with nothing, and the ones that made something to
 * open. Everything is read off the cards; nothing is tracked separately.
 */
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import { WORK_REASON_LOOK } from "../home/ThreadReportCard";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import type { GrowBoardCard, GrowPlayReport } from "./grow.logic";

const percent = (report: GrowPlayReport) => Math.round((report.played.length / report.total) * 100);

/** The header chip with the headline number; it opens the report. */
export function PlayReportButton(props: {
  readonly report: GrowPlayReport;
  readonly now: number;
  /** Picks a thread: Grow shows it (and, on narrow windows, opens its card). */
  readonly onPick: (key: string) => void;
}) {
  const { report } = props;
  const [open, setOpen] = useState(false);
  if (report.total === 0) return null;
  const pick = (key: string) => {
    setOpen(false);
    props.onPick(key);
  };
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        data-grow-report-button=""
        aria-label={`${report.played.length} of ${report.total} threads made something to open`}
        onClick={() => setOpen(true)}
      >
        <PlayIcon />
        <span className="tabular-nums">{percent(report)}%</span>
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogPopup className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                <span className="tabular-nums">{percent(report)}%</span> of threads reached play
              </DialogTitle>
              <DialogDescription>
                {report.played.length} of {report.total} made something to open: a preview, a report
                or a pull request.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="flex flex-col gap-5" data-grow-report="">
                <Section
                  title="Stuck before play"
                  empty="Nothing is stuck."
                  count={report.stuck.length}
                >
                  {report.stuck.map((card) => (
                    <ThreadLine
                      key={card.key}
                      card={card}
                      onPick={pick}
                      note={`${formatElapsedDurationLabel(card.thread.createdAt, props.now)} with nothing to open`}
                      showState
                    />
                  ))}
                </Section>
                <Section
                  title="Ended with nothing"
                  empty="Every finished thread made something."
                  count={report.ended.length}
                >
                  {report.ended.map((card) => (
                    <ThreadLine key={card.key} card={card} onPick={pick} />
                  ))}
                </Section>
                <Section
                  title="Reached play"
                  empty="Nothing to open yet."
                  count={report.played.length}
                >
                  {report.played.map(({ card, openable }) => (
                    <ThreadLine key={card.key} card={card} onPick={pick} open={openable} />
                  ))}
                </Section>
              </div>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function Section(props: {
  readonly title: string;
  readonly empty: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-1">
      <h3 className="font-medium text-sm">
        {props.title} <span className="text-muted-foreground tabular-nums">{props.count}</span>
      </h3>
      {props.count === 0 ? (
        <p className="text-muted-foreground text-xs">{props.empty}</p>
      ) : (
        <ul className="flex flex-col">{props.children}</ul>
      )}
    </section>
  );
}

function ThreadLine(props: {
  readonly card: GrowBoardCard;
  readonly onPick: (key: string) => void;
  /** Why it is listed, at the end of the line. */
  readonly note?: string;
  /** What the thread is doing right now, for the ones that are stuck. */
  readonly showState?: boolean;
  /** The thing it made, with a link that opens it. */
  readonly open?: { readonly url: string; readonly label: string };
}) {
  const { card } = props;
  const look = WORK_REASON_LOOK[card.reason];
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50">
      <button
        type="button"
        data-grow-report-thread={card.thread.id}
        className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => props.onPick(card.key)}
      >
        {props.showState ? (
          <span
            role="img"
            aria-label={look.label}
            className={cn("size-1.5 shrink-0 rounded-full", look.dot)}
          />
        ) : null}
        <span className="min-w-0 truncate">{card.thread.title}</span>
      </button>
      {props.showState ? (
        <span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
          {look.label}
        </span>
      ) : null}
      {props.note ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{props.note}</span>
      ) : null}
      {props.open ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="max-w-40 shrink-0"
          title={props.open.url}
          render={<a href={props.open.url} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          <span className="truncate">{props.open.label}</span>
        </Button>
      ) : null}
    </li>
  );
}
