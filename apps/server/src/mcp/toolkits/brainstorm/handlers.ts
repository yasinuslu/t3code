import {
  BrainstormError,
  type BrainstormSpace,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Crypto from "effect/Crypto";
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
  addTask,
  deleteTask,
  type ParsedTask,
  updateTask,
} from "../../../brainstorm/taskMarkdown.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { BrainstormToolkit, type TaskEntry, type ThreadEntry, type ThreadStatus } from "./tools.ts";

const fail = (message: string) => new BrainstormError({ message });

const MESSAGE_TEXT_LIMIT = 4_000;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

type ThreadShell = OrchestrationV2ThreadShell;

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

export function describeThread(context: BrainstormContext, thread: ThreadShell): ThreadEntry {
  const project = context.projects.find((candidate) => candidate.id === thread.projectId);
  return {
    threadId: thread.id,
    title: thread.title,
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
  task: Pick<ParsedTask, "number" | "title" | "done" | "notes" | "threadIds">,
  threads: ReadonlyArray<ThreadShell>,
): TaskEntry {
  return {
    number: task.number,
    title: task.title,
    done: task.done,
    notes: task.notes,
    threads: task.threadIds.map((threadId) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      return { threadId, title: thread?.title ?? null, status: threadStatusOf(thread) };
    }),
  };
}

const make = Effect.gen(function* () {
  const brainstorm = yield* BrainstormService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:brainstorm-${tag}:${id}`)));

  /**
   * What the calling thread sees and a fresh context. A brainstorm chat sees
   * its space; any other thread sees All, and its task tools default to its
   * project's home space.
   */
  const scope = Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const context = yield* brainstorm.context;
    const brainstormSpace = yield* brainstorm.spaceOfThread(invocation.threadId);
    if (brainstormSpace !== null) {
      return { space: brainstormSpace, taskHome: null, context, threadId: invocation.threadId };
    }
    const all = context.spaces.find((candidate) => candidate.id === ALL_SPACE_ID);
    if (!all) return yield* fail("The All space is missing.");
    const own = yield* orchestrator
      .getThreadShell(invocation.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const homeId = own === null ? null : homeSpaceIdOf(context, own.projectId);
    const taskHome = context.spaces.find((candidate) => candidate.id === homeId) ?? null;
    return { space: all, taskHome, context, threadId: invocation.threadId };
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
   * this chat's, or the calling thread's home space.
   */
  const taskSpace = (
    context: BrainstormContext,
    own: BrainstormSpace,
    reference: string | undefined,
    home: BrainstormSpace | null = null,
  ): Effect.Effect<BrainstormSpace, BrainstormError> => {
    if (reference === undefined) {
      if (own.id !== ALL_SPACE_ID) return Effect.succeed(own);
      if (home !== null) return Effect.succeed(home);
      const fallback = context.spaces.find(
        (space) => space.kind === "profile" && space.profile === context.defaultProfile?.name,
      );
      return fallback
        ? Effect.succeed(fallback)
        : Effect.fail(fail("Pass the space whose task list to use."));
    }
    const space = findSpace(context, reference);
    if (!space) return Effect.fail(fail(`There is no space "${reference}".`));
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
      const { context } = yield* scope;
      const shell = yield* orchestrator
        .getThreadShell(ThreadId.make(threadId))
        .pipe(Effect.mapError(() => fail("Could not read the thread.")));
      if (shell === null) return yield* fail(`Thread ${threadId} is gone.`);
      return describeThread(context, shell);
    });

  const couldNot = (what: string) => (cause: unknown) =>
    fail(
      `Could not ${what}${
        typeof cause === "object" && cause !== null && "message" in cause
          ? `: ${String((cause as { message: unknown }).message)}`
          : "."
      }`,
    );
  const dispatch = (command: Parameters<typeof orchestrator.dispatch>[0], what: string) =>
    orchestrator.dispatch(command).pipe(Effect.mapError(couldNot(what)));

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
          fail(`No single project in ${space.name} matches "${reference}". Use list_projects.`),
        );
  };

  return BrainstormToolkit.of({
    brainstorm_overview: () =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        return {
          space: space.name,
          spaceId: space.id,
          seesEverything: space.id === ALL_SPACE_ID,
          brainPath: brainPathOf(context, space),
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
        const { space, taskHome, context } = yield* scope;
        const spaces =
          input.space === undefined && space.id === ALL_SPACE_ID && taskHome === null
            ? context.spaces.filter((candidate) => candidate.kind !== "all")
            : [yield* taskSpace(context, space, input.space, taskHome)];
        const threads = yield* allThreads(true);
        const lists = [];
        for (const candidate of spaces) {
          const list = yield* brainstorm.readTaskList(context, candidate);
          if (spaces.length > 1 && list.tasks.length === 0) {
            continue;
          }
          lists.push({
            space: candidate.name,
            spaceId: candidate.id,
            path: list.path,
            tasks: list.tasks.map((task) => describeTask(task, threads)),
          });
        }
        return { lists };
      }),

    add_task: (input) =>
      Effect.gen(function* () {
        const { space, taskHome, context } = yield* scope;
        const target = yield* taskSpace(context, space, input.space, taskHome);
        if (input.title.trim().length === 0) return yield* fail("A task needs a title.");
        const number = yield* brainstorm.editTasks(context, target, (text) => {
          const added = addTask(text, {
            title: input.title,
            notes: input.notes ?? [],
            threadIds: input.threadIds ?? [],
          });
          return { text: added.text, result: added.number };
        });
        return { space: target.name, number, path: taskPathOf(context, target) ?? "" };
      }),

    update_task: (input) =>
      Effect.gen(function* () {
        const { space, taskHome, context } = yield* scope;
        const target = yield* taskSpace(context, space, input.space, taskHome);
        const task = yield* brainstorm.editTasks(context, target, (text) => {
          const updated = updateTask(text, input.task, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.done === undefined ? {} : { done: input.done }),
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
        const { space, taskHome, context } = yield* scope;
        const target = yield* taskSpace(context, space, input.space, taskHome);
        const task = yield* brainstorm.editTasks(context, target, (text) => {
          const updated = updateTask(text, input.task, { done: input.done ?? true });
          return { text: updated.text, result: updated.task };
        });
        return describeTask(task, yield* allThreads(true));
      }),

    delete_task: (input) =>
      Effect.gen(function* () {
        const { space, taskHome, context } = yield* scope;
        const target = yield* taskSpace(context, space, input.space, taskHome);
        const removed = yield* brainstorm.editTasks(context, target, (text) => {
          const result = deleteTask(text, input.task);
          return { text: result.text, result: result.task };
        });
        return { title: removed.title };
      }),

    list_threads: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
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
          .map((thread) => describeThread(context, thread))
          .toSorted((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
        const limit = Math.max(1, Math.min(input.limit ?? 40, 200));
        return { threads: threads.slice(0, limit), total: threads.length };
      }),

    read_thread: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        const thread = yield* requireThread(context, space, input.threadId);
        const turns = Math.max(1, Math.min(input.turns ?? 3, 20));
        const records = yield* orchestrator
          .getThreadRecords(thread.id, ["runs", "messages"], {
            messageRoles: ["user", "assistant"],
          })
          .pipe(Effect.mapError(() => fail("Could not read the thread's messages.")));
        // The last `turns` runs, by the order they were asked for.
        const recentRuns = new Set<RunId>(
          records.runs
            .toSorted((left, right) => left.ordinal - right.ordinal)
            .slice(-turns)
            .map((run) => run.id),
        );
        const messages = records.messages
          .filter((message) => message.runId !== null && recentRuns.has(message.runId))
          .toSorted(
            (left, right) =>
              DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
          )
          .map((message) => ({
            role: message.role,
            text: cut(message.text, MESSAGE_TEXT_LIMIT),
            createdAt: DateTime.formatIso(message.createdAt),
          }));
        return { thread: describeThread(context, thread), messages };
      }),

    list_projects: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        let filterSpace = space;
        if (input.space !== undefined) {
          const requested = findSpace(context, input.space);
          if (!requested) return yield* fail(`There is no space "${input.space}".`);
          if (space.id !== ALL_SPACE_ID && requested.id !== space.id) {
            return yield* fail(`This brainstorm only sees ${space.name}.`);
          }
          filterSpace = requested;
        }
        return {
          projects: context.projects
            .filter((project) => inScope(context, filterSpace, project.id))
            .map((project) => ({
              projectId: project.id,
              title: project.title,
              path: project.workspaceRoot,
              spaces: spaceIdsOfProject(context, project.id).map(
                (spaceId) => context.spaces.find((entry) => entry.id === spaceId)?.name ?? spaceId,
              ),
            })),
        };
      }),

    settle_thread: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        const thread = yield* requireThread(context, space, input.threadId, false);
        const settle = input.settled ?? true;
        if (settle && thread.settledOverride !== "settled") {
          yield* dispatch(
            { type: "thread.settle", commandId: yield* commandId("settle"), threadId: thread.id },
            "settle the thread",
          );
        } else if (!settle && thread.settledOverride === "settled") {
          yield* dispatch(
            {
              type: "thread.unsettle",
              commandId: yield* commandId("unsettle"),
              threadId: thread.id,
              reason: "user",
            },
            "unsettle the thread",
          );
        }
        return yield* refreshed(thread.id);
      }),

    archive_thread: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        const thread = yield* requireThread(context, space, input.threadId);
        const archive = input.archived ?? true;
        if (archive && thread.archivedAt === null) {
          yield* dispatch(
            { type: "thread.archive", commandId: yield* commandId("archive"), threadId: thread.id },
            "archive the thread",
          );
        } else if (!archive && thread.archivedAt !== null) {
          yield* dispatch(
            {
              type: "thread.unarchive",
              commandId: yield* commandId("unarchive"),
              threadId: thread.id,
            },
            "restore the thread",
          );
        }
        return { threadId: thread.id, archived: archive };
      }),

    rename_thread: (input) =>
      Effect.gen(function* () {
        const { space, context } = yield* scope;
        const thread = yield* requireThread(context, space, input.threadId, false);
        const title = input.title.replace(/\s+/g, " ").trim();
        if (title.length === 0) return yield* fail("A title cannot be empty.");
        yield* dispatch(
          {
            type: "thread.metadata.update",
            commandId: yield* commandId("rename"),
            threadId: thread.id,
            title,
          },
          "rename the thread",
        );
        return yield* refreshed(thread.id);
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

    start_thread: (input) =>
      Effect.gen(function* () {
        const { space, taskHome, context } = yield* scope;
        const project = yield* findProject(context, space, input.project);
        const prompt = input.prompt.trim();
        if (prompt.length === 0) return yield* fail("The first prompt cannot be empty.");
        const taskTarget =
          input.task === undefined
            ? null
            : yield* taskSpace(context, space, input.taskSpace, taskHome);
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError(() => fail("Could not read the server settings.")),
        );
        const projectSettings = resolveProjectSettings(settings, project.id, project).settings;
        const threads = yield* allThreads(false);
        const recent = threads
          .filter((thread) => thread.projectId === project.id)
          .toSorted(
            (left, right) =>
              DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
          )[0];
        const modelSelection: ModelSelection = projectSettings.defaultModelSelection ??
          settings.defaultModelSelection ??
          recent?.modelSelection ?? {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          };
        const title = (input.title ?? prompt.split("\n")[0] ?? "New thread")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        let workspaceStrategy: ThreadLaunchService.ThreadLaunchInput["workspaceStrategy"] = {
          type: "root",
        };
        if (input.worktree === true) {
          // The same launch the new-thread composer sends for "New worktree": V2
          // provisions the worktree, names its branch and runs the setup script
          // before the first turn starts.
          const baseBranch =
            input.baseBranch?.trim() ||
            (yield* gitWorkflow.localStatus({ cwd: project.workspaceRoot }).pipe(
              Effect.map((status) => status.refName),
              Effect.orElseSucceed(() => null),
            ));
          if (!baseBranch) {
            return yield* fail(
              `${project.title} is not on a git branch to start a worktree from; pass baseBranch.`,
            );
          }
          const branch = input.branch?.trim();
          workspaceStrategy = {
            type: "worktree",
            baseRef: baseBranch,
            ...(branch ? { branch } : {}),
            ...(projectSettings.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
          };
        }
        const threadId = ThreadId.make(yield* uuid);
        const launched = yield* launches
          .launch({
            commandId: yield* commandId("thread"),
            threadId,
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode: projectSettings.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy,
            initialMessage: {
              messageId: MessageId.make(yield* uuid),
              text: prompt,
              attachments: [],
            },
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(
            Effect.mapError(
              couldNot(
                input.worktree === true ? "start the thread in a new worktree" : "start the thread",
              ),
            ),
          );
        // The thread exists from here on, even if its workspace is still being prepared.
        if (taskTarget !== null && input.task !== undefined) {
          const reference = input.task;
          yield* brainstorm.editTasks(context, taskTarget, (text) => {
            const updated = updateTask(text, reference, { addThreadIds: [threadId] });
            return { text: updated.text, result: undefined };
          });
        }
        const shell = yield* orchestrator
          .getThreadShell(threadId)
          .pipe(Effect.orElseSucceed(() => null));
        return {
          threadId,
          title,
          project: project.title,
          branch: shell?.branch ?? launched.projection.thread.branch ?? null,
          worktreePath: shell?.worktreePath ?? launched.projection.thread.worktreePath ?? null,
        };
      }),
  });
});

export const BrainstormToolkitHandlersLive = BrainstormToolkit.toLayer(make);
