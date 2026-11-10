import type { OrchestrationV2PlanArtifact, OrchestrationV2Run } from "@t3tools/contracts";
import { CheckCheckIcon, ChevronDownIcon, ChevronUpIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";

import { useForkFeature } from "~/forkFeatures";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { selectLiveTodoList, stepProgress, type TimelineRowRef } from "./liveSteps.logic";
import { StepChecklist } from "./StepChecklist";

/**
 * The agent's step list pinned above the composer. Open while the run works, a one-line summary
 * once it ends, and gone once dismissed or when a newer run writes no list.
 */
export function useLiveStepsBannerItem(
  projection: {
    readonly runs: ReadonlyArray<OrchestrationV2Run>;
    readonly plans: ReadonlyArray<OrchestrationV2PlanArtifact>;
    readonly turnItems: ReadonlyArray<TimelineRowRef>;
  } | null,
): ComposerBannerStackItem | null {
  const enabled = useForkFeature("liveSteps");
  const [openByPlan, setOpenByPlan] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [dismissedPlan, setDismissedPlan] = useState<string | null>(null);
  if (!enabled || projection === null) return null;
  const selected = selectLiveTodoList(projection.runs, projection.plans, projection.turnItems);
  if (selected === null) return null;
  const { plan, live } = selected;
  if (!live && dismissedPlan === plan.id) return null;
  const { done, total, current } = stepProgress(plan.steps);
  const allDone = done === total;
  const open = openByPlan.get(plan.id) ?? live;
  const toggle = () => setOpenByPlan((previous) => new Map(previous).set(plan.id, !open));
  return {
    id: "live-steps",
    variant: "default",
    icon: allDone ? <CheckCheckIcon className="text-success" /> : <ListChecksIcon />,
    title: allDone && !live ? `All ${total} steps done` : `Steps ${done}/${total}`,
    ...(current === undefined || (allDone && !live)
      ? {}
      : { description: live ? current.text : `Stopped at: ${current.text}` }),
    actions: (
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-expanded={open}
        aria-label={open ? "Hide steps" : "Show steps"}
        onClick={toggle}
      >
        {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
      </Button>
    ),
    ...(live ? {} : { dismissLabel: "Hide step list", onDismiss: () => setDismissedPlan(plan.id) }),
    ...(open
      ? {
          children: (
            <StepChecklist
              steps={plan.steps}
              className="max-h-[min(15rem,35dvh)] px-1 pt-1 pb-0.5"
            />
          ),
        }
      : {}),
  };
}
