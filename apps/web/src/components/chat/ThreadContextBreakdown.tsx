import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextBreakdownItem,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { contextBreakdownEnvironment } from "../../state/contextBreakdown";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";

const TOP_ITEMS = 5;

// Keyed by the provider's stable row id; an unknown id falls back to a neutral swatch.
const CATEGORY_COLOR: Record<string, string> = {
  system_prompt: "bg-violet-500",
  system_tools: "bg-sky-500",
  mcp_tools: "bg-cyan-500",
  mcp_instructions: "bg-teal-500",
  custom_agents: "bg-amber-500",
  memory_files: "bg-orange-500",
  skills: "bg-yellow-500",
  messages: "bg-emerald-500",
  autocompact_buffer: "bg-muted-foreground/35",
  compact_buffer: "bg-muted-foreground/35",
  free_space: "bg-muted-foreground/15",
};

function categoryColor(category: ContextBreakdownCategory): string {
  return (category.id !== null ? CATEGORY_COLOR[category.id] : undefined) ?? "bg-foreground/40";
}

function percentOf(tokens: number, max: number): string {
  if (max <= 0) return "0%";
  const percent = (tokens / max) * 100;
  return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

/** Collapsed by default: opening it asks the provider to count every category once. */
export function ThreadContextBreakdown({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    open ? contextBreakdownEnvironment.breakdown({ environmentId, input: { threadId } }) : null,
  );
  const result = query.data;

  return (
    <div className="flex flex-col">
      <div className="flex h-6 items-center justify-between px-1">
        <Button
          size="micro"
          variant="ghost-muted"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
          Breakdown
        </Button>
        {open && (result !== null || query.error !== null) ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Count again"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon className={cn(query.isPending && "animate-spin")} />
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="px-2.5 pt-1 text-xs">
          {result?._tag === "available" ? (
            <BreakdownBody breakdown={result.breakdown} />
          ) : result?._tag === "unavailable" ? (
            <p className="text-muted-foreground">
              {result.reason === "no-session"
                ? "No live session. Send a message to start one, then count again."
                : "This provider reports only the total, not a breakdown."}
            </p>
          ) : query.error !== null ? (
            <p className="text-error-foreground">{query.error}</p>
          ) : (
            <p className="text-muted-foreground">Counting tokens…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BreakdownBody({ breakdown }: { readonly breakdown: ContextBreakdown }) {
  const max = breakdown.maxTokens;
  const inWindow = breakdown.categories.filter(
    (category) => category.kind !== "deferred" && category.tokens > 0,
  );
  // Free space is the bar's track, so only the used rows and the reserve are drawn on it.
  const segments = inWindow.filter((category) => category.kind !== "free");
  return (
    <div className="flex flex-col gap-2.5">
      {/* Claude measures against its effective window, which a lower auto-compact window shrinks. */}
      <p className="text-muted-foreground tabular-nums">
        {formatContextWindowTokens(breakdown.totalTokens)} of {formatContextWindowTokens(max)} ·{" "}
        {breakdown.model}
      </p>
      <div
        role="img"
        aria-label={`${formatContextWindowTokens(breakdown.totalTokens)} of ${formatContextWindowTokens(max)} tokens used`}
        className="flex h-2 overflow-hidden rounded-full bg-muted-foreground/15"
      >
        {segments.map((category) => (
          <span
            key={`${category.id ?? category.name}`}
            className={cn("h-full", categoryColor(category))}
            style={{ width: `${(category.tokens / Math.max(max, 1)) * 100}%` }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1">
        {inWindow.map((category) => (
          <li key={category.id ?? category.name} className="col-span-4 grid grid-cols-subgrid">
            <span aria-hidden className={cn("size-2 rounded-xs", categoryColor(category))} />
            <span className="truncate text-muted-foreground">{category.name}</span>
            <span className="text-end font-medium tabular-nums text-foreground/80">
              {formatContextWindowTokens(category.tokens)}
            </span>
            <span className="w-10 text-end tabular-nums text-muted-foreground">
              {percentOf(category.tokens, max)}
            </span>
          </li>
        ))}
      </ul>
      <ItemList title="MCP tools" items={breakdown.mcpTools} />
      <ItemList title="Memory files" items={breakdown.memoryFiles} fileNames />
      <ItemList title="Skills" items={breakdown.skills} />
      <ItemList title="Custom agents" items={breakdown.agents} />
    </div>
  );
}

function ItemList({
  title,
  items,
  fileNames = false,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<ContextBreakdownItem>;
  readonly fileNames?: boolean;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, TOP_ITEMS);
  return (
    <div className="flex flex-col gap-0.5">
      <h4 className="text-2xs font-medium text-muted-foreground">
        {title}
        {items.length > shown.length ? ` · top ${shown.length} of ${items.length}` : null}
      </h4>
      <ul className="flex flex-col">
        {shown.map((item) => (
          <li
            key={`${item.detail ?? ""}:${item.name}`}
            className="flex min-w-0 items-baseline justify-between gap-2"
          >
            <span className="min-w-0 truncate text-foreground/80">
              {fileNames ? item.name.split(/[\\/]/).slice(-2).join("/") : item.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatContextWindowTokens(item.tokens)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
