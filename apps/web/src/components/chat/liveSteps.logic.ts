import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
  OrchestrationV2Run,
} from "@t3tools/contracts";

/** Enough of a turn item to place a todo list in the timeline. */
export interface TimelineRowRef {
  readonly type: string;
  readonly ordinal: number;
  readonly planId?: unknown;
}

export type TodoListPlan = Extract<OrchestrationV2PlanArtifact, { readonly kind: "todo_list" }>;

export interface StepProgress {
  readonly done: number;
  readonly total: number;
  readonly current: OrchestrationV2PlanStep | undefined;
}

export function stepProgress(steps: ReadonlyArray<OrchestrationV2PlanStep>): StepProgress {
  return {
    done: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
    current:
      steps.find((step) => step.status === "running") ??
      steps.find((step) => step.status === "pending"),
  };
}

const LIVE_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>(["starting", "running", "waiting"]);
const UNSTARTED_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>(["preparing", "queued"]);

export interface LiveTodoList {
  readonly plan: TodoListPlan;
  /** The run that wrote the list is still working. */
  readonly live: boolean;
}

/**
 * The step list to pin above the composer: the newest todo list of the thread's latest started
 * run. A run that never wrote one hides the pin, so an old list never claims a new turn.
 */
export function selectLiveTodoList(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "status">>,
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
  turnItems: ReadonlyArray<TimelineRowRef>,
): LiveTodoList | null {
  let latestRun: (typeof runs)[number] | undefined;
  for (const run of runs) {
    if (UNSTARTED_RUN_STATUSES.has(run.status)) continue;
    if (latestRun === undefined || run.ordinal > latestRun.ordinal) latestRun = run;
  }
  if (latestRun === undefined) return null;
  // Plan ids do not order a run's lists; the row each one wrote in the timeline does.
  const ordinalByPlan = new Map<string, number>();
  for (const item of turnItems) {
    if (item.type === "todo_list" && typeof item.planId === "string") {
      ordinalByPlan.set(item.planId, item.ordinal);
    }
  }
  let plan: TodoListPlan | undefined;
  for (const candidate of plans) {
    if (
      candidate.kind === "todo_list" &&
      candidate.status !== "superseded" &&
      candidate.runId === latestRun.id &&
      candidate.steps.length > 0 &&
      (plan === undefined ||
        (ordinalByPlan.get(candidate.id) ?? -1) >= (ordinalByPlan.get(plan.id) ?? -1))
    ) {
      plan = candidate;
    }
  }
  if (plan === undefined) return null;
  return { plan, live: LIVE_RUN_STATUSES.has(latestRun.status) };
}
