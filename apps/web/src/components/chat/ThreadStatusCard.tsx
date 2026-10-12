import type { ScopedThreadRef, ThreadStatusReport } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon } from "lucide-react";
import { memo } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";

const OPEN_STORAGE_KEY = "t3code:thread-status-card-open";

/** The report's first line as plain text, for the collapsed card. */
function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * The status card an agent set with `thread_status_update`, pinned above the
 * thread's messages so where things stand and what the user owes stay in view
 * however long the thread gets. Open or closed is remembered across threads.
 */
export const ThreadStatusCard = memo(function ThreadStatusCard(props: {
  readonly report: ThreadStatusReport;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
}) {
  const [open, setOpen] = useLocalStorage(OPEN_STORAGE_KEY, true, Schema.Boolean);
  const updated = formatRelativeTimeLabel(props.report.updatedAt);
  return (
    <section
      aria-label="Thread status"
      className="shrink-0 border-b bg-card/60 text-card-foreground"
      data-thread-status-card
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col px-4">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 py-2 text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="shrink-0 font-medium">Status</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {open ? null : firstLine(props.report.text)}
          </span>
          {updated ? (
            <span className="shrink-0 text-muted-foreground tabular-nums">{updated}</span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")}
          />
        </button>
        {open ? (
          <div className="max-h-[40vh] min-w-0 overflow-y-auto pb-2">
            <ChatMarkdown text={props.report.text} cwd={props.cwd} threadRef={props.threadRef} />
          </div>
        ) : null}
      </div>
    </section>
  );
});
