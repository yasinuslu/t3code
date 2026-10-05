import { BrainstormError, OrchestratorMcpThreadLink } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as BrainstormService from "../../../brainstorm/BrainstormService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  BrainstormService.BrainstormService,
  Orchestrator.OrchestratorV2,
];

const SCOPE =
  "In the manager chat (and any thread outside a brainstorm) it sees every space; in a space's brainstorm chat it is scoped to that space.";

const SpaceInput = Schema.optional(
  Schema.String.annotate({
    description:
      "Space id, name or profile: whose brain the list lives in. The manager must pass it on every write; elsewhere it defaults to this chat's space, or in a regular thread to its project's space.",
  }),
);

const GoalReferenceInput = Schema.Union([Schema.Int, Schema.String]).annotate({
  description: "The goal's number from list_tasks, or its title (exact, or a unique part of it).",
});

const TaskReferenceInput = Schema.Union([Schema.Int, Schema.String]).annotate({
  description:
    "The task's number from list_tasks, or its title (exact, or a unique part of it). Numbers shift when tasks above are added or removed, so re-list after edits.",
});

const ThreadStatus = Schema.Literals([
  "working",
  "needs-approval",
  "needs-input",
  "failed",
  "ready",
  "settled",
  "archived",
  "missing",
]).annotate({
  description:
    "working: a turn is running; ready: idle, finished its last turn; settled: done and moved out of the active list; archived: hidden; missing: deleted or unknown.",
});

const LinkedThread = Schema.Struct({
  threadId: Schema.String,
  title: Schema.NullOr(Schema.String),
  status: ThreadStatus,
});

const TaskEntry = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  goal: Schema.String,
  threads: Schema.Array(LinkedThread),
});

const GoalEntry = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  tasks: Schema.Array(TaskEntry),
});

const TaskListEntry = Schema.Struct({
  space: Schema.String,
  spaceId: Schema.String,
  profile: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  goals: Schema.Array(GoalEntry),
});

const ThreadEntry = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  link: OrchestratorMcpThreadLink,
  status: ThreadStatus,
  project: Schema.String,
  projectId: Schema.String,
  spaces: Schema.Array(Schema.String),
  lastActivityAt: Schema.String,
  branch: Schema.NullOr(Schema.String),
});

// `annotate` keeps the tool's own type, which a `Tool.Any` receiver would widen away.
const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

const writeTool = <T extends Tool.Any>(tool: T, destructive = false): T =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, destructive)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false) as T;

const ManagerOverviewTool = readonlyTool(
  Tool.make("manager_overview", {
    description: `Start here, and again after a restart or context compaction. Returns the manager's operating rules, whether this chat is the manager, every profile's brain with the file its goals and tasks live in, and the spaces. ${SCOPE}`,
    success: Schema.Struct({
      isManager: Schema.Boolean,
      instructions: Schema.Array(Schema.String),
      space: Schema.String,
      spaceId: Schema.String,
      seesEverything: Schema.Boolean,
      brainPath: Schema.NullOr(Schema.String),
      profiles: Schema.Array(
        Schema.Struct({
          profile: Schema.String,
          space: Schema.NullOr(Schema.String),
          brainPath: Schema.String,
          taskFile: Schema.NullOr(Schema.String),
          projects: Schema.Array(Schema.String),
        }),
      ),
      spaces: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          kind: Schema.String,
          taskFile: Schema.NullOr(Schema.String),
          inScope: Schema.Boolean,
        }),
      ),
    }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Manager overview"),
);

const ListTasksTool = readonlyTool(
  Tool.make("list_tasks", {
    description: `List goals and their tasks, with the status of the threads each task links to: for the manager every space's list, in a regular thread its project's space, unless space is given. Tasks above every goal are under Inbox. Done goals are left out unless includeDone. ${SCOPE}`,
    parameters: Schema.Struct({ space: SpaceInput, includeDone: Schema.optional(Schema.Boolean) }),
    success: Schema.Struct({ lists: Schema.Array(TaskListEntry) }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "List tasks"),
);

const AddTaskTool = writeTool(
  Tool.make("add_task", {
    description: `Add a task as the last one of a goal (the Inbox when goal is unset). Add the goal first with add_goal. ${SCOPE}`,
    parameters: Schema.Struct({
      title: Schema.String.annotate({ description: "One line." }),
      goal: Schema.optional(GoalReferenceInput),
      notes: Schema.optional(
        Schema.Array(Schema.String).annotate({ description: "Note or link lines under the task." }),
      ),
      threadIds: Schema.optional(Schema.Array(Schema.String)),
      space: SpaceInput,
    }),
    success: Schema.Struct({ space: Schema.String, number: Schema.Int, path: Schema.String }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Add task"),
);

const AddGoalTool = writeTool(
  Tool.make("add_goal", {
    description: `Add a goal (a "## title" heading) at the end of a space's list. Pick the space by whose goal it is: each goal lives in the brain of the profile it belongs to. ${SCOPE}`,
    parameters: Schema.Struct({
      title: Schema.String.annotate({ description: "One line: the outcome, not the steps." }),
      notes: Schema.optional(
        Schema.Array(Schema.String).annotate({ description: "Why it matters, done-when, links." }),
      ),
      space: SpaceInput,
    }),
    success: Schema.Struct({ space: Schema.String, number: Schema.Int, path: Schema.String }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Add goal"),
);

const UpdateGoalTool = writeTool(
  Tool.make("update_goal", {
    description: `Rename a goal, replace its notes, or mark it done (done=false reopens it). Only its heading and notes change. ${SCOPE}`,
    parameters: Schema.Struct({
      goal: GoalReferenceInput,
      space: SpaceInput,
      title: Schema.optional(Schema.String),
      notes: Schema.optional(Schema.Array(Schema.String)),
      done: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Struct({
      number: Schema.Int,
      title: Schema.String,
      done: Schema.Boolean,
      notes: Schema.Array(Schema.String),
    }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Update goal"),
);

const DeleteGoalTool = writeTool(
  Tool.make("delete_goal", {
    description: `Remove an empty goal. A goal with tasks stays; mark finished goals done with update_goal instead. ${SCOPE}`,
    parameters: Schema.Struct({ goal: GoalReferenceInput, space: SpaceInput }),
    success: Schema.Struct({ title: Schema.String }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Delete goal"),
  true,
);

const UpdateTaskTool = writeTool(
  Tool.make("update_task", {
    description: `Change a task: rename it, replace its notes, mark it done or not, link/unlink the threads working on it, or move it to another goal. Only that task's lines in the file change. ${SCOPE}`,
    parameters: Schema.Struct({
      task: TaskReferenceInput,
      space: SpaceInput,
      goal: Schema.optional(GoalReferenceInput),
      title: Schema.optional(Schema.String),
      notes: Schema.optional(Schema.Array(Schema.String)),
      done: Schema.optional(Schema.Boolean),
      linkThreadIds: Schema.optional(Schema.Array(Schema.String)),
      unlinkThreadIds: Schema.optional(Schema.Array(Schema.String)),
    }),
    success: TaskEntry,
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Update task"),
);

const CompleteTaskTool = writeTool(
  Tool.make("complete_task", {
    description: `Check a task off (or reopen it with done=false). ${SCOPE}`,
    parameters: Schema.Struct({
      task: TaskReferenceInput,
      space: SpaceInput,
      done: Schema.optional(Schema.Boolean),
    }),
    success: TaskEntry,
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Complete task"),
);

const DeleteTaskTool = writeTool(
  Tool.make("delete_task", {
    description: `Remove a task and its notes from the list. Prefer complete_task for finished work. ${SCOPE}`,
    parameters: Schema.Struct({ task: TaskReferenceInput, space: SpaceInput }),
    success: Schema.Struct({ title: Schema.String }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Delete task"),
  true,
);

const ListThreadsTool = readonlyTool(
  Tool.make("list_threads", {
    description: `List T3 Code threads across every project in scope, most recent activity first, with a one-word status (needs-approval, needs-input and failed are what needs attention), project and spaces. Settled and archived threads are left out unless asked for. Act on a thread with the t3_thread_* and t3_pending_request_* tools. ${SCOPE}`,
    parameters: Schema.Struct({
      space: SpaceInput,
      project: Schema.optional(
        Schema.String.annotate({ description: "Only threads of this project (id or title)." }),
      ),
      includeSettled: Schema.optional(Schema.Boolean),
      includeArchived: Schema.optional(Schema.Boolean),
      limit: Schema.optional(Schema.Int.annotate({ description: "Default 40." })),
    }),
    success: Schema.Struct({ threads: Schema.Array(ThreadEntry), total: Schema.Int }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "List threads"),
);

const SetThreadSpaceTool = writeTool(
  Tool.make("set_thread_space", {
    description: `Add a thread's project to a custom space, or remove it (member=false). Custom spaces hold projects, so every thread of that project follows. Profile spaces and Other follow the project's path and cannot be changed. ${SCOPE}`,
    parameters: Schema.Struct({
      threadId: Schema.String,
      space: Schema.String.annotate({ description: "Custom space id or name." }),
      member: Schema.optional(Schema.Boolean),
    }),
    success: ThreadEntry,
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Set thread space"),
);

export const BrainstormToolkit = Toolkit.make(
  ManagerOverviewTool,
  ListTasksTool,
  AddGoalTool,
  UpdateGoalTool,
  DeleteGoalTool,
  AddTaskTool,
  UpdateTaskTool,
  CompleteTaskTool,
  DeleteTaskTool,
  ListThreadsTool,
  SetThreadSpaceTool,
);

export type ThreadEntry = typeof ThreadEntry.Type;
export type ThreadStatus = typeof ThreadStatus.Type;
export type TaskEntry = typeof TaskEntry.Type;
export type GoalEntry = typeof GoalEntry.Type;
