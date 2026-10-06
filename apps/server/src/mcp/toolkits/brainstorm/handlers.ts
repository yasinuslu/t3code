import {
  BrainstormError,
  type BrainstormSpace,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { formatThreadMarkdownLink } from "@t3tools/shared/threadLinks";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  ALL_SPACE_ID,
  type BrainstormContext,
  brainPathOf,
  BrainstormService,
  findSpace,
  homeSpaceIdOf,
  isProjectInSpace,
  spaceIdsOfProject,
  taskPathOf,
} from "../../../brainstorm/BrainstormService.ts";
import {
  addGoal,
  addTask,
  deleteGoal,
  deleteTask,
  INBOX_GOAL,
  type ParsedTask,
  parseTaskMarkdown,
  updateGoal,
  updateTask,
} from "../../../brainstorm/taskMarkdown.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { BrainstormToolkit, type TaskEntry, type ThreadEntry, type ThreadStatus } from "./tools.ts";

const fail = (message: string) => new BrainstormError({ message });

type ThreadShell = OrchestrationV2ThreadShell;

/**
 * How the manager chat works. Returned by manager_overview, which the manager
 * reads at the start of every conversation and after a restart or compaction,
 * so the rules never depend on what is still in its context.
 */
export const MANAGER_INSTRUCTIONS: ReadonlyArray<string> = [
  "You are the manager. The user talks to you; the work happens in other T3 Code threads (workers). Your job is that goals finish without the user pushing each step.",
  "Durable state is the truth, not your memory: goals and tasks live in each profile brain's task file (list_tasks), thread state lives in T3 Code (list_threads, t3_thread_read). Re-read both after a restart or compaction before acting.",
  "Every piece of work is a task under a goal. New goal: add_goal, then add_task for each step. Loose ideas go to the Inbox (add_task without goal).",
  "A goal belongs to one profile and lives in that profile's brain. Pass space on every write. Work for one profile never goes into another profile's list; when it is unclear whose goal it is, ask the user once.",
  "To start work on a task: find the project with t3_project_list, start a worker with t3_thread_launch (projectId, a clear title, the full task in message; use a worktree workspaceStrategy for code changes), then link it with update_task linkThreadIds. A task without a linked thread is not being worked on.",
  "Follow workers with list_threads (status), t3_thread_wait and t3_thread_read. Steer with t3_thread_send. Stop with t3_thread_interrupt.",
  "Answer routine worker questions yourself (t3_pending_request_list, t3_pending_request_read, t3_pending_request_respond): conventions, where things are, which of two equivalent options, retry after a transient failure.",
  "Bring the user in only for real decisions: tool approvals (you cannot grant them), anything destructive, irreversible or outward-facing (publishing, merging, spending money, messaging people), a change of scope or goal, and choices with no clear default. Say it in this chat in one or two lines: which thread, what it needs, your recommendation.",
  "When a worker fails or needs approval or input you cannot give, tell the user here; the work overlay's Needs you list shows the same threads.",
  "Close the loop: when a worker's result checks out, complete_task and settle the thread (t3_thread_organize settle). When every task of a goal is done, update_goal done=true and tell the user in one line.",
  "Keep replies short. Report outcomes, not plans.",
];

const ACTIVE_STATUSES = new Set(["preparing", "queued", "starting", "running"]);
const FAILED_STATUSES = new Set(["failed", "interrupted", "cancelled", "rolled_back"]);

/** One word for where a thread stands, from its shell. */
export function threadStatusOf(thread: ThreadShell | null | undefined): ThreadStatus {
  if (!thread || thread.deletedAt !== null) return "missing";
  if (thread.archivedAt !== null) return "archived";
  const request = thread.pendingRuntimeRequest;
  if (request !== null) return request.kind === "user_input" ? "needs-input" : "needs-approval";
  if (thread.activeRunId !== null || ACTIVE_STATUSES.has(thread.status)) return "working";
  if (thread.status === "waiting") return "needs-input";
  if (thread.settledOverride === "settled") return "settled";
  if (FAILED_STATUSES.has(thread.status)) return "failed";
  return "ready";
}

const iso = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

/** The latest moment something happened in the thread. */
export function lastActivityOf(thread: ThreadShell): string {
  const candidates = [
    thread.updatedAt,
    thread.latestUserMessageAt,
    thread.latestRunCompletedAt,
    thread.latestRunStartedAt,
    thread.settledAt,
  ]
    .map(iso)
    .filter((value): value is string => value !== null);
  return candidates.toSorted().at(-1) ?? DateTime.formatIso(thread.createdAt);
}

/** A work thread a person started; subagent and fork children travel with their root. */
const isTopLevel = (thread: ThreadShell) =>
  thread.deletedAt === null && thread.lineage.relationshipToParent !== "subagent";

export function describeThread(
  context: BrainstormContext,
  thread: ThreadShell,
  environmentId: EnvironmentId,
): ThreadEntry {
  const project = context.projects.find((candidate) => candidate.id === thread.projectId);
  return {
    threadId: thread.id,
    title: thread.title,
    link: formatThreadMarkdownLink({ environmentId, threadId: thread.id, title: thread.title }),
    status: threadStatusOf(thread),
    project: project?.title ?? thread.projectId,
    projectId: thread.projectId,
    spaces: spaceIdsOfProject(context, thread.projectId).map(
      (spaceId) => context.spaces.find((space) => space.id === spaceId)?.name ?? spaceId,
    ),
    lastActivityAt: lastActivityOf(thread),
    branch: thread.branch,
  };
}

export function describeTask(
  task: Pick<ParsedTask, "number" | "title" | "done" | "notes" | "threadIds" | "goal">,
  threads: ReadonlyArray<ThreadShell>,
): TaskEntry {
  return {
    number: task.number,
    title: task.title,
    done: task.done,
    notes: task.notes,
    goal: task.goal,
    threads: task.threadIds.map((threadId) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      return { threadId, title: thread?.title ?? null, status: threadStatusOf(thread) };
    }),
  };
}

const make = Effect.gen(function* () {
  const brainstorm = yield* BrainstormService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  /**
   * What the calling thread sees and a fresh context. A space's brainstorm
   * chat sees its space; the manager (All's chat) and any other thread see
   * All. A regular thread's task tools default to its project's home space;
   * the manager names the space on every write.
   */
  const scope = Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const context = yield* brainstorm.context;
    const brainstormSpace = yield* brainstorm.spaceOfThread(invocation.threadId);
    if (brainstormSpace !== null) {
      return {
        space: brainstormSpace,
        taskHome: null,
        context,
        isManager: brainstormSpace.kind === "all",
        threadId: invocation.threadId,
        environmentId: invocation.environmentId,
      };
    }
    const all = context.spaces.find((candidate) => candidate.id === ALL_SPACE_ID);
    if (!all) return yield* fail("The All space is missing.");
    const own = yield* orchestrator
      .getThreadShell(invocation.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const homeId = own === null ? null : homeSpaceIdOf(context, own.projectId);
    const taskHome = context.spaces.find((candidate) => candidate.id === homeId) ?? null;
    return {
      space: all,
      taskHome,
      context,
      isManager: false,
      threadId: invocation.threadId,
      environmentId: invocation.environmentId,
    };
  });

  /** Active and (optionally) archived thread shells, without subagent children. */
  const allThreads = (includeArchived: boolean) =>
    Effect.gen(function* () {
      const active = yield* orchestrator.getShellSnapshot({ location: "active" });
      const archived = includeArchived
        ? (yield* orchestrator.getShellSnapshot({ location: "archive" })).archivedThreads
        : [];
      return [...active.threads, ...archived].filter(isTopLevel);
    }).pipe(Effect.mapError(() => fail("Could not read the threads.")));

  const inScope = (context: BrainstormContext, space: BrainstormSpace, projectId: string) =>
    isProjectInSpace(context, projectId, space.id);

  /**
   * The space a task tool works on: the given one (checked against scope), or
   * this chat's, or the calling thread's home space. The manager reads every
   * list but must name the one it writes to, so a goal never lands in another
   * profile's brain by default.
   */
  const taskSpace = (
    scoped: Effect.Success<typeof scope>,
    reference: string | undefined,
    write: boolean,
  ): Effect.Effect<BrainstormSpace, BrainstormError> => {
    const { context, space: own, taskHome } = scoped;
    if (reference === undefined) {
      if (own.id !== ALL_SPACE_ID) return Effect.succeed(own);
      if (scoped.isManager && write) {
        return Effect.fail(
          fail(
            "Pass space: the profile (or space) whose brain this goal or task belongs to. See manager_overview for the profiles.",
          ),
        );
      }
      if (taskHome !== null) return Effect.succeed(taskHome);
      const fallback = context.spaces.find(
        (space) => space.kind === "profile" && space.profile === context.defaultProfile?.name,
      );
      return fallback
        ? Effect.succeed(fallback)
        : Effect.fail(fail("Pass the space whose task list to use."));
    }
    const space = findSpace(context, reference);
    if (!space) return Effect.fail(fail(`There is no space "${reference}".`));
    if (space.kind === "all") {
      return Effect.fail(fail("All has no list of its own. Pass a profile or space."));
    }
    if (own.id !== ALL_SPACE_ID && space.id !== own.id) {
      return Effect.fail(
        fail(`This brainstorm belongs to ${own.name}; it cannot change ${space.name}'s tasks.`),
      );
    }
    return Effect.succeed(space);
  };

  const requireThread = (
    context: BrainstormContext,
    space: BrainstormSpace,
    threadId: string,
    includeArchived = true,
  ) =>
    Effect.gen(function* () {
      const threads = yield* allThreads(includeArchived);
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread || !inScope(context, space, thread.projectId)) {
        return yield* fail(`Thread ${threadId} is not in ${space.name}.`);
      }
      if (context.brainstormThreadIds.has(thread.id)) {
        return yield* fail("That is a brainstorm chat, not a work thread.");
      }
      return thread;
    });

  const refreshed = (threadId: string) =>
    Effect.gen(function* () {
      const { context, environmentId } = yield* scope;
      const shell = yield* orchestrator
        .getThreadShell(ThreadId.make(threadId))
        .pipe(Effect.mapError(() => fail("Could not read the thread.")));
      if (shell === null) return yield* fail(`Thread ${threadId} is gone.`);
      return describeThread(context, shell, environmentId);
    });

  const findProject = (
    context: BrainstormContext,
    space: BrainstormSpace,
    reference: string,
  ): Effect.Effect<OrchestrationProjectShell, BrainstormError> => {
    const wanted = reference.trim().toLowerCase();
    const candidates = context.projects.filter((project) => inScope(context, space, project.id));
    const match =
      candidates.find((project) => project.id === reference) ??
      candidates.find((project) => project.title.toLowerCase() === wanted) ??
      (() => {
        const partial = candidates.filter((project) =>
          project.title.toLowerCase().includes(wanted),
        );
        return partial.length === 1 ? partial[0] : undefined;
      })();
    return match
      ? Effect.succeed(match)
      : Effect.fail(
          fail(`No single project in ${space.name} matches "${reference}". Use t3_project_list.`),
        );
  };

  const goalOf = (text: string, number: number) => {
    const goal = parseTaskMarkdown(text).goals[number - 1]!;
    return { number: goal.number, title: goal.title, done: goal.done, notes: goal.notes };
  };

  return BrainstormToolkit.of({
    manager_overview: () =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const { space, context } = scoped;
        const profileSpace = (name: string) =>
          context.spaces.find(
            (candidate) => candidate.kind === "profile" && candidate.profile === name,
          ) ?? null;
        return {
          isManager: scoped.isManager,
          instructions: scoped.isManager ? MANAGER_INSTRUCTIONS : [],
          space: space.name,
          spaceId: space.id,
          seesEverything: space.id === ALL_SPACE_ID,
          brainPath: brainPathOf(context, space),
          profiles: context.profiles.map((profile) => {
            const owned = profileSpace(profile.name);
            return {
              profile: profile.name,
              space: owned?.name ?? null,
              brainPath: profile.brainPath,
              taskFile: owned === null ? null : taskPathOf(context, owned),
              projects: context.projects
                .filter((project) => context.profileByProjectId.get(project.id) === profile.name)
                .map((project) => project.title),
            };
          }),
          spaces: context.spaces.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            kind: candidate.kind,
            taskFile: taskPathOf(context, candidate),
            inScope: space.id === ALL_SPACE_ID || candidate.id === space.id,
          })),
        };
      }),

    list_tasks: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const { space, taskHome, context } = scoped;
        const spaces =
          input.space === undefined && space.id === ALL_SPACE_ID && taskHome === null
            ? context.spaces.filter((candidate) => candidate.kind !== "all")
            : [yield* taskSpace(scoped, input.space, false)];
        const threads = yield* allThreads(true);
        const lists = [];
        for (const candidate of spaces) {
          const list = yield* brainstorm.readTaskList(context, candidate);
          if (spaces.length > 1 && list.tasks.length === 0 && list.goals.length === 0) {
            continue;
          }
          lists.push({
            space: candidate.name,
            spaceId: candidate.id,
            profile: list.profile,
            path: list.path,
            goals: list.goals
              .filter((goal) => input.includeDone === true || !goal.done)
              .map((goal) => ({
                ...goal,
                tasks: list.tasks
                  .filter((task) => task.goal === goal.title)
                  .map((task) => describeTask(task, threads)),
              })),
          });
        }
        return { lists };
      }),

    add_goal: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        const number = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const added = addGoal(text, { title: input.title, notes: input.notes ?? [] });
          return { text: added.text, result: added.number };
        });
        return { space: target.name, number, path: taskPathOf(scoped.context, target) ?? "" };
      }),

    update_goal: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        return yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const updated = updateGoal(text, input.goal, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.done === undefined ? {} : { done: input.done }),
          });
          return { text: updated.text, result: goalOf(updated.text, updated.goal.number) };
        });
      }),

    delete_goal: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        const removed = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const result = deleteGoal(text, input.goal);
          return { text: result.text, result: result.goal };
        });
        return { title: removed.title };
      }),

    add_task: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        if (input.title.trim().length === 0) return yield* fail("A task needs a title.");
        const number = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const added = addTask(text, {
            title: input.title,
            notes: input.notes ?? [],
            threadIds: input.threadIds ?? [],
            goal: input.goal ?? INBOX_GOAL,
          });
          return { text: added.text, result: added.number };
        });
        return { space: target.name, number, path: taskPathOf(scoped.context, target) ?? "" };
      }),

    update_task: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        const task = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const updated = updateTask(text, input.task, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.done === undefined ? {} : { done: input.done }),
            ...(input.goal === undefined ? {} : { goal: input.goal }),
            ...(input.linkThreadIds === undefined ? {} : { addThreadIds: input.linkThreadIds }),
            ...(input.unlinkThreadIds === undefined
              ? {}
              : { removeThreadIds: input.unlinkThreadIds }),
          });
          return { text: updated.text, result: updated.task };
        });
        return describeTask(task, yield* allThreads(true));
      }),

    complete_task: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        const task = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const updated = updateTask(text, input.task, { done: input.done ?? true });
          return { text: updated.text, result: updated.task };
        });
        return describeTask(task, yield* allThreads(true));
      }),

    delete_task: (input) =>
      Effect.gen(function* () {
        const scoped = yield* scope;
        const target = yield* taskSpace(scoped, input.space, true);
        const removed = yield* brainstorm.editTasks(scoped.context, target, (text) => {
          const result = deleteTask(text, input.task);
          return { text: result.text, result: result.task };
        });
        return { title: removed.title };
      }),

    list_threads: (input) =>
      Effect.gen(function* () {
        const { space, context, environmentId } = yield* scope;
        let filterSpace = space;
        if (input.space !== undefined) {
          const requested = findSpace(context, input.space);
          if (!requested) return yield* fail(`There is no space "${input.space}".`);
          if (space.id !== ALL_SPACE_ID && requested.id !== space.id) {
            return yield* fail(`This brainstorm only sees ${space.name}.`);
          }
          filterSpace = requested;
        }
        const project =
          input.project === undefined
            ? null
            : yield* findProject(context, filterSpace, input.project);
        const brainstormIds = context.brainstormThreadIds;
        const threads = (yield* allThreads(input.includeArchived === true))
          .filter((thread) => !brainstormIds.has(thread.id))
          .filter((thread) => inScope(context, filterSpace, thread.projectId))
          .filter((thread) => project === null || thread.projectId === project.id)
          .filter((thread) => input.includeSettled === true || thread.settledOverride !== "settled")
          .map((thread) => describeThread(context, thread, environmentId))
          .toSorted((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
        const limit = Math.max(1, Math.min(input.limit ?? 40, 200));
        return { threads: threads.slice(0, limit), total: threads.length };
      }),

    set_thread_space: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        const thread = yield* requireThread(context, space, input.threadId, false);
        const target = findSpace(context, input.space);
        if (!target) return yield* fail(`There is no space "${input.space}".`);
        yield* brainstorm.setProjectInCustomSpace(
          thread.projectId,
          target.id,
          input.member ?? true,
        );
        return yield* refreshed(thread.id);
      }),
  });
});

export const BrainstormToolkitHandlersLive = BrainstormToolkit.toLayer(make);
