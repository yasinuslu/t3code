import { NodeId, PlanId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectLiveTodoList, type TodoListPlan } from "./liveSteps.logic";

const threadId = ThreadId.make("thread-steps");
const run = (id: string, ordinal: number, status: "running" | "completed" | "queued") => ({
  id: RunId.make(id),
  ordinal,
  status,
});
const todo = (
  id: string,
  runId: string,
  status: TodoListPlan["status"] = "active",
): TodoListPlan => ({
  id: PlanId.make(id),
  threadId,
  runId: RunId.make(runId),
  nodeId: NodeId.make(`node-${id}`),
  status,
  kind: "todo_list",
  steps: [{ id: "step-1", text: "Read the code", status: "running" }],
});

const row = (planId: string, ordinal: number) => ({ type: "todo_list", planId, ordinal });

describe("selectLiveTodoList", () => {
  it("pins the newest list of the latest started run, live only while it runs", () => {
    // Ids sort the newer list first; its timeline row says it came later.
    const plans = [todo("a-newer", "run-2"), todo("b-older", "run-2"), todo("old", "run-1")];
    const rows = [row("b-older", 3), row("a-newer", 7)];
    expect(
      selectLiveTodoList([run("run-1", 1, "completed"), run("run-2", 2, "running")], plans, rows),
    ).toEqual({ plan: plans[0], live: true });
    // A queued follow-up has not started, so the list it will replace stays pinned.
    expect(
      selectLiveTodoList(
        [run("run-1", 1, "completed"), run("run-2", 2, "completed"), run("run-3", 3, "queued")],
        plans,
        rows,
      ),
    ).toEqual({ plan: plans[0], live: false });
  });

  it("hides when the latest run wrote no list or replaced it", () => {
    expect(
      selectLiveTodoList(
        [run("run-1", 1, "completed"), run("run-2", 2, "running")],
        [todo("old", "run-1")],
        [],
      ),
    ).toBeNull();
    expect(
      selectLiveTodoList([run("run-1", 1, "running")], [todo("gone", "run-1", "superseded")], []),
    ).toBeNull();
  });
});
