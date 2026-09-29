import {
  BrainstormError,
  type BrainstormSpace,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

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
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBootstrapDispatcher from "../../../orchestration/ThreadBootstrapDispatcher.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { BrainstormToolkit, type TaskEntry, type ThreadEntry, type ThreadStatus } from "./tools.ts";

const fail = (message: string) => new BrainstormError({ message });

const MESSAGE_TEXT_LIMIT = 4_000;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** One word for where a thread stands, from its shell. */
export function threadStatusOf(thread: OrchestrationThreadShell | undefined): ThreadStatus {
  if (!thread) return "missing";
  if (thread.archivedAt !== null) return "archived";
  if (thread.hasPendingApprovals) return "needs-approval";
  if (thread.hasPendingUserInput) return "needs-input";
  const session = thread.session?.status;
  if (session === "running" || session === "starting") return "working";
  if (thread.settledOverride === "settled") return "settled";
  if (session === "error" || thread.latestTurn?.state === "error") return "failed";
  return "ready";
}

/** The latest moment something happened in the thread. */
export function lastActivityOf(thread: OrchestrationThreadShell): string {
  const candidates = [
    thread.updatedAt,
    thread.latestUserMessageAt,
    thread.latestTurn?.completedAt,
    thread.latestTurn?.startedAt,
    thread.settledAt,
  ].filter((value): value is string => typeof value === "string");
  return candidates.toSorted().at(-1) ?? thread.createdAt;
}

export function describeThread(
  context: BrainstormContext,
  thread: OrchestrationThreadShell,
): ThreadEntry {
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
  threads: ReadonlyArray<OrchestrationThreadShell>,
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
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const bootstrapDispatcher = yield* ThreadBootstrapDispatcher.ThreadBootstrapDispatcher;
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
    const own = yield* snapshots.getThreadShellById(invocation.threadId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    const homeId = own === undefined ? null : homeSpaceIdOf(context, own.projectId);
    const taskHome = context.spaces.find((candidate) => candidate.id === homeId) ?? null;
    return { space: all, taskHome, context, threadId: invocation.threadId };
  });

  /** Active and (optionally) archived thread shells. */
  const allThreads = (includeArchived: boolean) =>
    Effect.gen(function* () {
      const active = yield* snapshots.getShellSnapshot();
      const archived = includeArchived ? (yield* snapshots.getArchivedShellSnapshot()).threads : [];
      return [...active.threads, ...archived];
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
      const shell = yield* snapshots
        .getThreadShellById(ThreadId.make(threadId))
        .pipe(Effect.mapError(() => fail("Could not read the thread.")));
      if (Option.isNone(shell)) return yield* fail(`Thread ${threadId} is gone.`);
      return describeThread(context, shell.value);
    });

  const couldNot = (what: string) => (cause: unknown) =>
    fail(
      `Could not ${what}${
        typeof cause === "object" && cause !== null && "message" in cause
          ? `: ${String((cause as { message: unknown }).message)}`
          : "."
      }`,
    );
  const dispatch = (command: Parameters<typeof engine.dispatch>[0], what: string) =>
    engine.dispatch(command).pipe(Effect.mapError(couldNot(what)));

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
        const detail = yield* snapshots
          .getThreadDetailSnapshot(thread.id, {
            turnLimit: Math.max(1, Math.min(input.turns ?? 3, 20)),
          })
          .pipe(Effect.mapError(() => fail("Could not read the thread's messages.")));
        const messages = Option.match(detail, {
          onNone: () => [],
          onSome: (snapshot) =>
            snapshot.thread.messages
              .filter((message) => message.role === "user" || message.role === "assistant")
              .map((message) => ({
                role: message.role,
                text: cut(message.text, MESSAGE_TEXT_LIMIT),
                createdAt: message.createdAt,
              })),
        });
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
            type: "thread.meta.update",
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
          .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
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
        const threadId = ThreadId.make(yield* uuid);
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const message = {
          messageId: MessageId.make(yield* uuid),
          role: "user" as const,
          text: prompt,
          attachments: [],
        };
        const linkTask = Effect.gen(function* () {
          if (taskTarget === null || input.task === undefined) return;
          const reference = input.task;
          yield* brainstorm.editTasks(context, taskTarget, (text) => {
            const updated = updateTask(text, reference, { addThreadIds: [threadId] });
            return { text: updated.text, result: undefined };
          });
        });
        if (input.worktree === true) {
          // The same bootstrap the new-thread composer sends in worktree mode.
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
          const token = (yield* uuid).replaceAll("-", "");
          yield* bootstrapDispatcher
            .dispatch({
              type: "thread.turn.start",
              commandId: yield* commandId("turn"),
              threadId,
              message,
              modelSelection,
              runtimeMode: projectSettings.defaultRuntimeMode,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              bootstrap: {
                createThread: {
                  projectId: project.id,
                  title,
                  modelSelection,
                  runtimeMode: projectSettings.defaultRuntimeMode,
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: baseBranch,
                  worktreePath: null,
                  createdAt,
                },
                prepareWorktree: {
                  projectCwd: project.workspaceRoot,
                  baseBranch,
                  requireWorktree: true,
                  branch: input.branch?.trim() || buildTemporaryWorktreeBranchName(() => token),
                  ...(projectSettings.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
                },
                runSetupScript: true,
              },
              createdAt,
            })
            .pipe(Effect.mapError(couldNot("start the thread in a new worktree")));
          // A failed bootstrap deletes the thread, so link only once it runs.
          yield* linkTask;
        } else {
          yield* dispatch(
            {
              type: "thread.create",
              commandId: yield* commandId("thread"),
              threadId,
              projectId: project.id,
              title,
              modelSelection,
              runtimeMode: projectSettings.defaultRuntimeMode,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt,
            },
            "create the thread",
          );
          // Link before the turn starts, so the task points at the thread even
          // if the first turn fails.
          yield* linkTask;
          yield* dispatch(
            {
              type: "thread.turn.start",
              commandId: yield* commandId("turn"),
              threadId,
              message,
              modelSelection,
              runtimeMode: projectSettings.defaultRuntimeMode,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt,
            },
            "start the thread's first turn",
          );
        }
        const shell = yield* snapshots.getThreadShellById(threadId).pipe(
          Effect.map(Option.getOrUndefined),
          Effect.orElseSucceed(() => undefined),
        );
        return {
          threadId,
          title,
          project: project.title,
          branch: shell?.branch ?? null,
          worktreePath: shell?.worktreePath ?? null,
        };
      }),
  });
});

export const BrainstormToolkitHandlersLive = BrainstormToolkit.toLayer(make);
