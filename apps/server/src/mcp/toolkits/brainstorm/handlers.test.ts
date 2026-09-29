import {
  type BrainstormSpace,
  BrainstormError,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import {
  type BrainstormContext,
  BrainstormService,
  taskPathOf,
} from "../../../brainstorm/BrainstormService.ts";
import { parseTaskMarkdown } from "../../../brainstorm/taskMarkdown.ts";
import { GitWorkflowService } from "../../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadBootstrapDispatcher } from "../../../orchestration/ThreadBootstrapDispatcher.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { BrainstormToolkitHandlersLive, threadStatusOf } from "./handlers.ts";
import { BrainstormToolkit } from "./tools.ts";

const SPACES: ReadonlyArray<BrainstormSpace> = [
  { id: "all", name: "All", kind: "all", profile: null },
  { id: "space-work", name: "work", kind: "profile", profile: "work" },
  { id: "space-home", name: "home", kind: "profile", profile: "home" },
  { id: "space-side", name: "Side Quests", kind: "custom", profile: null },
  { id: "other", name: "Other", kind: "other", profile: null },
];

const BRAINSTORM_ALL = ThreadId.make("brainstorm-all");
const BRAINSTORM_WORK = ThreadId.make("brainstorm-work");
const BRAINSTORM_HOME = ThreadId.make("brainstorm-home");
const WORK_THREAD = ThreadId.make("thread-work");
const HOME_THREAD = ThreadId.make("thread-home");
const SETTLED_THREAD = ThreadId.make("thread-settled");

const project = (id: string, title: string, root: string): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: root,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const PROJECTS = [
  project("p-work", "api", "/code/work/api"),
  project("p-home", "t3code", "/code/home/t3code"),
  project("p-home-brain", "home-brain", "/code/home/home-brain"),
];

const thread = (
  id: ThreadId,
  projectId: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id,
  projectId: ProjectId.make(projectId),
  title: `Thread ${id}`,
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const THREADS = [
  thread(WORK_THREAD, "p-work", { updatedAt: "2026-09-25T00:00:00.000Z" }),
  thread(HOME_THREAD, "p-home", {
    updatedAt: "2026-09-26T00:00:00.000Z",
    session: {
      threadId: HOME_THREAD,
      status: "running",
      providerName: "claudeAgent",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-09-26T00:00:00.000Z",
    },
  }),
  thread(SETTLED_THREAD, "p-home", {
    settledOverride: "settled",
    settledAt: "2026-09-10T00:00:00.000Z",
  }),
  thread(BRAINSTORM_HOME, "p-home-brain"),
];

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const makeHarness = Effect.fn("makeBrainstormHarness")(function* (
  initialFiles: Record<string, string> = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const files = new Map(Object.entries(initialFiles));
  const memberships: Record<string, ReadonlyArray<string>> = {};
  const context: BrainstormContext = {
    spaces: SPACES,
    profiles: [
      { name: "home", path: "/code/home", brainPath: "/code/home/home-brain" },
      { name: "work", path: "/code/work", brainPath: "/code/work/work-brain" },
    ],
    defaultProfile: { name: "home", path: "/code/home", brainPath: "/code/home/home-brain" },
    threadIdsBySpaceId: {
      all: BRAINSTORM_ALL,
      "space-work": BRAINSTORM_WORK,
      "space-home": BRAINSTORM_HOME,
    },
    brainstormThreadIds: new Set([BRAINSTORM_ALL, BRAINSTORM_WORK, BRAINSTORM_HOME]),
    customSpaceIdsByProjectId: memberships,
    profileByProjectId: new Map([
      ["p-work", "work"],
      ["p-home", "home"],
      ["p-home-brain", "home"],
    ]),
    projects: PROJECTS,
  };
  const membershipCalls: Array<[string, string, boolean]> = [];

  const brainstorm = Layer.mock(BrainstormService)({
    context: Effect.succeed(context),
    spaceOfThread: (threadId) =>
      Effect.succeed(
        SPACES.find((space) => context.threadIdsBySpaceId[space.id] === threadId) ?? null,
      ),
    readTaskList: (ctx, space) =>
      Effect.sync(() => {
        const path = taskPathOf(ctx, space);
        return {
          spaceId: space.id,
          spaceName: space.name,
          path,
          tasks: parseTaskMarkdown(path === null ? "" : (files.get(path) ?? "")).tasks,
        };
      }),
    editTasks: (ctx, space, edit) =>
      Effect.gen(function* () {
        const path = taskPathOf(ctx, space);
        if (path === null) return yield* new BrainstormError({ message: "no list" });
        const outcome = yield* Effect.try({
          try: () => edit(files.get(path) ?? ""),
          catch: (cause) => new BrainstormError({ message: String(cause) }),
        });
        files.set(path, outcome.text);
        return outcome.result;
      }),
    setProjectInCustomSpace: (projectId, spaceId, member) =>
      Effect.sync(() => {
        membershipCalls.push([projectId, spaceId, member]);
        memberships[projectId] = member ? [spaceId] : [];
      }),
  });
  const dependencies = Layer.mergeAll(
    brainstorm,
    Layer.mock(ProjectionSnapshotQuery)({
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: PROJECTS,
          threads: THREADS,
          updatedAt: "2026-09-27T00:00:00.000Z",
        }),
      getArchivedShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [],
          threads: [],
          updatedAt: "2026-09-27T00:00:00.000Z",
        }),
      getThreadShellById: (threadId) =>
        Effect.succeed(Option.fromNullishOr(THREADS.find((entry) => entry.id === threadId))),
      getThreadDetailSnapshot: (threadId) =>
        Effect.succeedSome({
          snapshotSequence: 1,
          thread: {
            ...THREADS.find((entry) => entry.id === threadId)!,
            messages: [
              { role: "user", text: "fix the bug", createdAt: "2026-09-25T00:00:00.000Z" },
              { role: "system", text: "hidden", createdAt: "2026-09-25T00:00:01.000Z" },
              { role: "assistant", text: "done", createdAt: "2026-09-25T00:00:02.000Z" },
            ],
          },
        } as unknown as OrchestrationThreadDetailSnapshot),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(Effect.as({ sequence: 1 })),
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        defaultModelSelection: null,
        projectSettingsOverrides: {},
      } as never),
    }),
    Layer.mock(ThreadBootstrapDispatcher)({
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(Effect.as({ sequence: 1 })),
    }),
    Layer.mock(GitWorkflowService)({
      localStatus: () => Effect.succeed({ refName: "main" } as never),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const toolkit = yield* BrainstormToolkit.pipe(
    Effect.provide(BrainstormToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof BrainstormToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    threadId: ThreadId = BRAINSTORM_HOME,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof BrainstormToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        capabilities: new Set(["pull-requests"] as const),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return { commands, call, files, membershipCalls };
});

const HOME_TASKS = "/code/home/home-brain/tasks.md";
const WORK_TASKS = "/code/work/work-brain/tasks.md";

describe("brainstorm toolkit", () => {
  it.effect("a regular thread sees every space and projects", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const overview = yield* harness.call("brainstorm_overview", {}, WORK_THREAD);
      expect(overview).toMatchObject({ spaceId: "all", seesEverything: true });
      const projects = yield* harness.call("list_projects", {}, WORK_THREAD);
      expect(projects.projects.map((entry) => entry.title)).toEqual([
        "api",
        "t3code",
        "home-brain",
      ]);
      const scoped = yield* harness.call("list_projects", { space: "work" }, WORK_THREAD);
      expect(scoped.projects.map((entry) => entry.title)).toEqual(["api"]);
      const threads = yield* harness.call("list_threads", {}, WORK_THREAD);
      expect(threads.threads.map((entry) => entry.threadId)).toEqual([HOME_THREAD, WORK_THREAD]);
    }),
  );

  it.effect("a regular thread's task tools default to its project's space", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        [HOME_TASKS]: "- [ ] home task\n",
        [WORK_TASKS]: "- [ ] work task\n",
      });
      const listed = yield* harness.call("list_tasks", {}, WORK_THREAD);
      expect(listed.lists.map((list) => list.space)).toEqual(["work"]);
      const added = yield* harness.call("add_task", { title: "From work" }, WORK_THREAD);
      expect(added).toEqual({ space: "work", number: 2, path: WORK_TASKS });
      yield* harness.call("add_task", { title: "For home", space: "home" }, WORK_THREAD);
      expect(harness.files.get(HOME_TASKS)).toBe("- [ ] home task\n- [ ] For home\n");
      expect(harness.files.get(WORK_TASKS)).toBe("- [ ] work task\n- [ ] From work\n");
    }),
  );

  it.effect("a regular thread starts threads in any space's project", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [WORK_TASKS]: "- [ ] Ship it\n" });
      const started = yield* harness.call(
        "start_thread",
        { project: "t3code", prompt: "hi", task: 1, taskSpace: "work" },
        WORK_THREAD,
      );
      expect(started.project).toBe("t3code");
      expect((yield* Ref.get(harness.commands)).map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
      ]);
      expect((yield* Ref.get(harness.commands))[0]).toMatchObject({ projectId: "p-home" });
      expect(harness.files.get(WORK_TASKS)).toBe(
        `- [ ] Ship it\n  - thread: ${started.threadId}\n`,
      );
    }),
  );

  it.effect("a regular thread still cannot act on brainstorm chats", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("rename_thread", { threadId: BRAINSTORM_HOME, title: "x" }, WORK_THREAD)
        .pipe(Effect.flip);
      expect(error.message).toContain("brainstorm chat, not a work thread");
    }),
  );

  it.effect("adds, completes and deletes tasks in the space's own file", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [HOME_TASKS]: "# Tasks\n\n- [ ] Existing\n" });
      const added = yield* harness.call("add_task", { title: "Fix X", notes: ["see log"] });
      expect(added).toEqual({ space: "home", number: 2, path: HOME_TASKS });
      expect(harness.files.get(HOME_TASKS)).toBe(
        "# Tasks\n\n- [ ] Existing\n- [ ] Fix X\n  see log\n",
      );

      const completed = yield* harness.call("complete_task", { task: "fix x" });
      expect(completed).toMatchObject({ number: 2, title: "Fix X", done: true });

      yield* harness.call("delete_task", { task: 1 });
      expect(harness.files.get(HOME_TASKS)).toBe("# Tasks\n\n- [x] Fix X\n  see log\n");
    }),
  );

  it.effect("keeps a space's brainstorm out of other spaces' lists", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("add_task", { title: "sneaky", space: "work" })
        .pipe(Effect.flip);
      expect(error.message).toContain("cannot change work's tasks");
      expect(harness.files.has(WORK_TASKS)).toBe(false);
    }),
  );

  it.effect("All sees every list and writes where it is told", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        [HOME_TASKS]: "- [ ] home task\n",
        [WORK_TASKS]: "- [x] work task\n  - thread: thread-work\n",
      });
      const listed = yield* harness.call("list_tasks", {}, BRAINSTORM_ALL);
      expect(
        listed.lists.map((list) => [list.space, list.tasks.map((task) => task.title)]),
      ).toEqual([
        ["work", ["work task"]],
        ["home", ["home task"]],
      ]);
      expect(listed.lists[0]!.tasks[0]!.threads).toEqual([
        { threadId: "thread-work", title: "Thread thread-work", status: "ready" },
      ]);
      yield* harness.call("add_task", { title: "side", space: "Side Quests" }, BRAINSTORM_ALL);
      expect(harness.files.get("/code/home/home-brain/tasks/side-quests.md")).toBe("- [ ] side\n");
    }),
  );

  it.effect("lists only in-scope, unsettled work threads, newest first", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const home = yield* harness.call("list_threads", {});
      expect(home.threads.map((entry) => [entry.threadId, entry.status])).toEqual([
        [HOME_THREAD, "working"],
      ]);
      const withSettled = yield* harness.call("list_threads", { includeSettled: true });
      expect(withSettled.threads.map((entry) => entry.threadId)).toEqual([
        HOME_THREAD,
        SETTLED_THREAD,
      ]);
      const all = yield* harness.call("list_threads", {}, BRAINSTORM_ALL);
      expect(all.threads.map((entry) => entry.threadId)).toEqual([HOME_THREAD, WORK_THREAD]);
      expect(all.threads[1]).toMatchObject({ project: "api", spaces: ["work"] });
    }),
  );

  it.effect("reads a thread's user and assistant messages but not out-of-scope threads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const read = yield* harness.call("read_thread", { threadId: HOME_THREAD });
      expect(read.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      const error = yield* harness.call("read_thread", { threadId: WORK_THREAD }).pipe(Effect.flip);
      expect(error.message).toContain("not in home");
    }),
  );

  it.effect("settles, renames and archives through orchestration commands", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("settle_thread", { threadId: HOME_THREAD });
      yield* harness.call("rename_thread", { threadId: HOME_THREAD, title: "  New\nname " });
      yield* harness.call("archive_thread", { threadId: HOME_THREAD });
      expect((yield* Ref.get(harness.commands)).map((command) => command.type)).toEqual([
        "thread.settle",
        "thread.meta.update",
        "thread.archive",
      ]);
      expect((yield* Ref.get(harness.commands))[1]).toMatchObject({ title: "New name" });
    }),
  );

  it.effect("moves a thread's project into a custom space", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const moved = yield* harness.call("set_thread_space", {
        threadId: HOME_THREAD,
        space: "side quests",
      });
      expect(harness.membershipCalls).toEqual([["p-home", "space-side", true]]);
      expect(moved.spaces).toEqual(["home", "Side Quests"]);
    }),
  );

  it.effect("starts a thread from a task and links the task to it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [HOME_TASKS]: "- [ ] Port the parser\n" });
      const started = yield* harness.call("start_thread", {
        project: "t3code",
        prompt: "Port the parser to the server",
        task: 1,
      });
      expect(started.project).toBe("t3code");
      const commands = yield* Ref.get(harness.commands);
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
      ]);
      expect(commands[1]).toMatchObject({
        threadId: started.threadId,
        message: { role: "user", text: "Port the parser to the server" },
      });
      expect(harness.files.get(HOME_TASKS)).toBe(
        `- [ ] Port the parser\n  - thread: ${started.threadId}\n`,
      );
    }),
  );

  it.effect("starts a worktree thread through the same bootstrap as the composer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [HOME_TASKS]: "- [ ] Port the parser\n" });
      const started = yield* harness.call("start_thread", {
        project: "t3code",
        prompt: "Port the parser to the server",
        task: 1,
        worktree: true,
      });
      yield* harness.call("start_thread", {
        project: "t3code",
        prompt: "Try it on a branch",
        worktree: true,
        branch: "feat/parser",
        baseBranch: "release",
      });
      const commands = yield* Ref.get(harness.commands);
      expect(commands).toMatchObject([
        {
          type: "thread.turn.start",
          threadId: started.threadId,
          message: { role: "user", text: "Port the parser to the server" },
          bootstrap: {
            createThread: { projectId: "p-home", branch: "main", worktreePath: null },
            prepareWorktree: {
              projectCwd: "/code/home/t3code",
              baseBranch: "main",
              branch: "t3code/07070707",
              requireWorktree: true,
            },
            runSetupScript: true,
          },
        },
        {
          type: "thread.turn.start",
          bootstrap: { prepareWorktree: { baseBranch: "release", branch: "feat/parser" } },
        },
      ]);
      expect(harness.files.get(HOME_TASKS)).toBe(
        `- [ ] Port the parser\n  - thread: ${started.threadId}\n`,
      );
    }),
  );

  it.effect("will not start threads in another space's projects", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("start_thread", { project: "api", prompt: "hi" })
        .pipe(Effect.flip);
      expect(error.message).toContain("No single project in home");
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );
});

describe("threadStatusOf", () => {
  it("prefers what needs attention, then activity, then settlement", () => {
    expect(threadStatusOf(undefined)).toBe("missing");
    expect(threadStatusOf(thread(WORK_THREAD, "p", { hasPendingApprovals: true }))).toBe(
      "needs-approval",
    );
    expect(threadStatusOf(THREADS[1])).toBe("working");
    expect(threadStatusOf(THREADS[2])).toBe("settled");
    expect(
      threadStatusOf(thread(WORK_THREAD, "p", { archivedAt: "2026-09-01T00:00:00.000Z" })),
    ).toBe("archived");
    expect(threadStatusOf(THREADS[0])).toBe("ready");
  });
});
