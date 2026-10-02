import { BrainstormError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as BrainstormService from "../../../brainstorm/BrainstormService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  BrainstormService.BrainstormService,
  Orchestrator.OrchestratorV2,
  ThreadLaunchService.ThreadLaunchService,
  ServerSettings.ServerSettingsService,
];

const SCOPE =
  "In a T3 Code brainstorm chat it is scoped to that chat's space (the All space sees everything); in any other thread it sees every space.";

const SpaceInput = Schema.optional(
  Schema.String.annotate({
    description:
      "Space id or name. Defaults to this brainstorm's space, or in a regular thread to its project's space; in the All space it selects which space's list to use.",
  }),
);

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
  threads: Schema.Array(LinkedThread),
});

const TaskListEntry = Schema.Struct({
  space: Schema.String,
  spaceId: Schema.String,
  path: Schema.NullOr(Schema.String),
  tasks: Schema.Array(TaskEntry),
});

const ThreadEntry = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  status: ThreadStatus,
  project: Schema.String,
  projectId: Schema.String,
  spaces: Schema.Array(Schema.String),
  lastActivityAt: Schema.String,
  branch: Schema.NullOr(Schema.String),
});

const ProjectEntry = Schema.Struct({
  projectId: Schema.String,
  title: Schema.String,
  path: Schema.String,
  spaces: Schema.Array(Schema.String),
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

const BrainstormOverviewTool = readonlyTool(
  Tool.make("brainstorm_overview", {
    description: `Start here. Says which space this chat belongs to (All for a regular thread), what it can see, where each space keeps its task list (a markdown checklist in the brain repository), and the spaces there are. ${SCOPE}`,
    success: Schema.Struct({
      space: Schema.String,
      spaceId: Schema.String,
      seesEverything: Schema.Boolean,
      brainPath: Schema.NullOr(Schema.String),
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
  }).annotate(Tool.Title, "Brainstorm overview"),
);

const ListTasksTool = readonlyTool(
  Tool.make("list_tasks", {
    description: `List the tasks of this space (in the All brainstorm: of every space; in a regular thread: of its project's space; unless space is given), with the status of the threads each task links to. ${SCOPE}`,
    parameters: Schema.Struct({ space: SpaceInput }),
    success: Schema.Struct({ lists: Schema.Array(TaskListEntry) }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "List tasks"),
);

const AddTaskTool = writeTool(
  Tool.make("add_task", {
    description: `Add a task to the end of a space's task list. ${SCOPE}`,
    parameters: Schema.Struct({
      title: Schema.String.annotate({ description: "One line." }),
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

const UpdateTaskTool = writeTool(
  Tool.make("update_task", {
    description: `Change a task: rename it, replace its notes, mark it done or not, or link/unlink threads. Only that task's lines in the file change. ${SCOPE}`,
    parameters: Schema.Struct({
      task: TaskReferenceInput,
      space: SpaceInput,
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
    description: `List the T3 Code threads in scope, most recent activity first, with status, project and spaces. Settled and archived threads are left out unless asked for. ${SCOPE}`,
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

const ReadThreadTool = readonlyTool(
  Tool.make("read_thread", {
    description: `Read a thread's recent messages (user and assistant text, newest last). ${SCOPE}`,
    parameters: Schema.Struct({
      threadId: Schema.String,
      turns: Schema.optional(
        Schema.Int.annotate({ description: "Recent turns to read; default 3." }),
      ),
    }),
    success: Schema.Struct({
      thread: ThreadEntry,
      messages: Schema.Array(
        Schema.Struct({ role: Schema.String, text: Schema.String, createdAt: Schema.String }),
      ),
    }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Read thread"),
);

const ListProjectsTool = readonlyTool(
  Tool.make("list_projects", {
    description: `List the projects in scope, to pick one for start_thread. ${SCOPE}`,
    parameters: Schema.Struct({ space: SpaceInput }),
    success: Schema.Struct({ projects: Schema.Array(ProjectEntry) }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "List projects"),
);

const SettleThreadTool = writeTool(
  Tool.make("settle_thread", {
    description: `Settle a thread (mark it done; it leaves the active list) or, with settled=false, bring it back. A running thread cannot be settled. ${SCOPE}`,
    parameters: Schema.Struct({
      threadId: Schema.String,
      settled: Schema.optional(Schema.Boolean),
    }),
    success: ThreadEntry,
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Settle thread"),
);

const ArchiveThreadTool = writeTool(
  Tool.make("archive_thread", {
    description: `Archive a thread (hide it) or, with archived=false, restore it. ${SCOPE}`,
    parameters: Schema.Struct({
      threadId: Schema.String,
      archived: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Struct({ threadId: Schema.String, archived: Schema.Boolean }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Archive thread"),
);

const RenameThreadTool = writeTool(
  Tool.make("rename_thread", {
    description: `Rename a thread. ${SCOPE}`,
    parameters: Schema.Struct({ threadId: Schema.String, title: Schema.String }),
    success: ThreadEntry,
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Rename thread"),
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

const StartThreadTool = writeTool(
  Tool.make("start_thread", {
    description: `Start a new thread in a project with a first prompt, for example to turn a task into a coding thread. With task, the task links to the new thread. The thread runs in the project's own checkout, or with worktree=true in a new git worktree on its own branch, like choosing "New worktree" in the new-thread composer (the worktree and the project's setup script are ready before the first turn starts). The worktree is prepared after this returns, so branch and worktreePath are null until it is ready; list_threads shows the branch later. ${SCOPE}`,
    parameters: Schema.Struct({
      project: Schema.String.annotate({ description: "Project id or title (see list_projects)." }),
      prompt: Schema.String.annotate({ description: "The first message, sent as the user." }),
      title: Schema.optional(Schema.String),
      task: Schema.optional(TaskReferenceInput),
      taskSpace: SpaceInput,
      worktree: Schema.optional(Schema.Boolean).annotate({
        description: "Start in a new git worktree instead of the project's own checkout.",
      }),
      branch: Schema.optional(Schema.String).annotate({
        description:
          "With worktree: the new branch. Defaults to a temporary t3code/… branch that is renamed after the first turn.",
      }),
      baseBranch: Schema.optional(Schema.String).annotate({
        description:
          "With worktree: the branch to start from. Defaults to the branch the project's checkout is on.",
      }),
    }),
    success: Schema.Struct({
      threadId: Schema.String,
      title: Schema.String,
      project: Schema.String,
      branch: Schema.NullOr(Schema.String),
      worktreePath: Schema.NullOr(Schema.String),
    }),
    failure: BrainstormError,
    dependencies,
  }).annotate(Tool.Title, "Start thread"),
);

export const BrainstormToolkit = Toolkit.make(
  BrainstormOverviewTool,
  ListTasksTool,
  AddTaskTool,
  UpdateTaskTool,
  CompleteTaskTool,
  DeleteTaskTool,
  ListThreadsTool,
  ReadThreadTool,
  ListProjectsTool,
  SettleThreadTool,
  ArchiveThreadTool,
  RenameThreadTool,
  SetThreadSpaceTool,
  StartThreadTool,
);

export type ThreadEntry = typeof ThreadEntry.Type;
export type ThreadStatus = typeof ThreadStatus.Type;
export type TaskEntry = typeof TaskEntry.Type;
