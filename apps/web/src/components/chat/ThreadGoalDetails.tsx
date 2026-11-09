import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { presentProviderGoal } from "@t3tools/client-runtime/state/thread-execution";
import type { EnvironmentId, OrchestrationV2ProviderGoal, ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { useQuietThreadProjection } from "../../state/entities";
import { Button, InlineButton } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function GoalChecks(props: {
  readonly goal: OrchestrationV2ProviderGoal;
  readonly checkLog: ReadonlyArray<string>;
}) {
  const { goal, checkLog } = props;
  if (goal.checks === undefined && checkLog.length === 0) return null;
  // The log keeps only the latest checks, so number them back from the running count.
  const firstNumber = (goal.checks ?? checkLog.length) - checkLog.length + 1;
  const checks = checkLog.map((text, index) => ({ text, number: firstNumber + index })).reverse();
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">
        Checks{goal.checks === undefined ? "" : ` · ${goal.checks}`}
      </h3>
      {checkLog.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {goal.checks === 0
            ? "Not evaluated yet. The goal is checked each time the agent stops."
            : "The agent hasn't reported what these checks found."}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {checks.map(({ text, number }, index) => (
            <li key={number}>
              <details
                // The latest check opens already; older ones stay behind a click.
                open={index === 0}
                className="group rounded-lg border border-border/60 bg-muted/30"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  />
                  <span className="font-medium">Check {number}</span>
                  <span className="text-muted-foreground">Not met</span>
                </summary>
                <p className="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 ps-8 text-sm text-muted-foreground select-text">
                  {text}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The goal line's title. Opens the goal, its usage and what each check found. */
export function ThreadGoalDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly isWorking: boolean;
  readonly onSendCommand: (text: string, failureMessage: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Thread shells leave out the check log; the thread projection keeps it.
  const projection = useQuietThreadProjection(
    open ? scopeThreadRef(props.environmentId, props.threadId) : null,
  )?.projection;
  const goal =
    projection?.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    )?.goal ?? props.goal;
  const presentation = presentProviderGoal(goal, props.isWorking);
  const checkLog = goal.checkLog ?? (goal.lastCheck === undefined ? [] : [goal.lastCheck]);
  const lineTitle =
    presentation.usage === null
      ? presentation.title
      : `${presentation.title} · ${presentation.usage}`;
  const send = (text: string, failureMessage: string) => {
    setOpen(false);
    void props.onSendCommand(text, failureMessage);
  };
  return (
    <>
      <InlineButton tone="muted" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {lineTitle}
      </InlineButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{presentation.title}</DialogTitle>
            {presentation.usage === null ? null : (
              <DialogDescription>{presentation.usage}</DialogDescription>
            )}
          </DialogHeader>
          <DialogPanel>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Goal</h3>
              <p className="m-0 whitespace-pre-wrap break-words text-sm select-text">
                {goal.objective}
              </p>
            </section>
            <GoalChecks goal={goal} checkLog={checkLog} />
          </DialogPanel>
          <DialogFooter variant="bare">
            {presentation.canResume && !props.isWorking ? (
              <Button
                variant="outline"
                onClick={() => send("/goal resume", "Failed to resume goal.")}
              >
                Resume
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => send("/goal clear", "Failed to clear goal.")}>
              Clear goal
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
