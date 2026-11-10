import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { CheckIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "~/lib/utils";

function StepMark({ status }: { readonly status: OrchestrationV2PlanStep["status"] }) {
  if (status === "completed") {
    return (
      <span className="flex size-4 flex-none items-center justify-center rounded-full bg-success/15 text-success">
        <CheckIcon className="size-3" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 flex-none items-center justify-center rounded-full border",
        status === "running" ? "border-primary" : "border-muted-foreground/40",
      )}
    >
      {status === "running" ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

const STATUS_LABEL: Record<OrchestrationV2PlanStep["status"], string> = {
  completed: "Done",
  running: "In progress",
  pending: "Not started",
};

/**
 * An agent's steps as a checklist: done steps ticked and dimmed, the current one highlighted.
 * A list taller than its box keeps the current step in view as the agent moves on.
 */
export function StepChecklist({
  steps,
  className,
}: {
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly className?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const currentId = (
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "pending")
  )?.id;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the DOM list so the agent's current step stays visible
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || currentId === undefined || list.scrollHeight <= list.clientHeight) return;
    const row = list.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(currentId)}"]`);
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + row.offsetHeight / 2);
    }
  }, [currentId]);

  return (
    <ol
      ref={listRef}
      data-step-checklist="true"
      className={cn("flex flex-col gap-0.5 overflow-y-auto overscroll-contain", className)}
    >
      {steps.map((step) => (
        <li
          key={step.id}
          data-step-id={step.id}
          data-step-status={step.status}
          className={cn(
            "flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-xs/4",
            step.status === "running" && "bg-primary/8 font-medium text-foreground",
            step.status === "pending" && "text-foreground/80",
            step.status === "completed" && "text-muted-foreground",
          )}
        >
          <StepMark status={step.status} />
          <span className="sr-only">{STATUS_LABEL[step.status]}: </span>
          <span
            className={cn(
              "min-w-0 flex-1 wrap-anywhere",
              step.status === "completed" && "line-through decoration-muted-foreground/50",
            )}
          >
            {step.text}
          </span>
          {step.status === "completed" && step.durationMs !== undefined ? (
            <span className="flex-none text-3xs/4 text-muted-foreground/70 tabular-nums">
              {formatDuration(step.durationMs)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
