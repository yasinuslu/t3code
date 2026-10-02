import {
  type BrainstormSpace,
  BrainstormError,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import {
  type ThreadLaunchInput,
  ThreadLaunchService,
} from "../../../orchestration-v2/ThreadLaunchService.ts";
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

const at = (iso: string) => DateTime.makeUnsafe(iso);

const thread = (
  id: ThreadId,
  projectId: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  createdBy: "user",
  creationSource: "web",
  id,
  projectId: ProjectId.make(projectId),
  title: `Thread ${id}`,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  pendingBackgroundTasks: [],
  providerInstanceHistory: [],
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: at("2026-09-01T00:00:00.000Z"),
  updatedAt: at("2026-09-20T00:00:00.000Z"),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  ...overrides,
});

const SUBAGENT_THREAD = ThreadId.make("thread-subagent");

const THREADS = [
  thread(WORK_THREAD, "p-work", { updatedAt: at("2026-09-25T00:00:00.000Z") }),
  thread(HOME_THREAD, "p-home", {
    updatedAt: at("2026-09-26T00:00:00.000Z"),
    status: "running",
    activeRunId: RunId.make("run-home-2"),
  }),
  thread(SETTLED_THREAD, "p-home", {
    settledOverride: "settled",
    settledAt: at("2026-09-10T00:00:00.000Z"),
  }),
  thread(BRAINSTORM_HOME, "p-home-brain"),
  // A Claude subagent's child thread: it travels with its parent, not on its own.
  thread(SUBAGENT_THREAD, "p-home", {
    updatedAt: at("2026-09-27T00:00:00.000Z"),
    lineage: {
      parentThreadId: HOME_THREAD,
      relationshipToParent: "subagent",
      rootThreadId: HOME_THREAD,
    },
  }),
];

const homeRun = (ordinal: number): OrchestrationV2Run => ({
  id: RunId.make(`run-home-${ordinal}`),
  threadId: HOME_THREAD,
  ordinal,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message-user-${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status: ordinal === 2 ? "running" : "completed",
  requestedAt: at("2026-09-25T00:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
});

const message = (
  ordinal: number,
  role: "user" | "assistant",
  text: string,
  second: number,
): OrchestrationV2ConversationMessage => ({
  createdBy: role === "user" ? "user" : "agent",
  creationSource: "web",
  id: MessageId.make(`message-${role}-${ordinal}-${second}`),
  threadId: HOME_THREAD,
  runId: RunId.make(`run-home-${ordinal}`),
  nodeId: null,
  role,
  text,
  attachments: [],
  streaming: false,
  createdAt: at(`2026-09-25T00:00:0${second}.000Z`),
  updatedAt: at(`2026-09-25T00:00:0${second}.000Z`),
});

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const makeHarness = Effect.fn("makeBrainstormHarness")(function* (
  initialFiles: Record<string, string> = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const launched = yield* Ref.make<ReadonlyArray<ThreadLaunchInput>>([]);
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
    Layer.mock(OrchestratorV2)({
      getShellSnapshot: (options) =>
        Effect.succeed({
          schemaVersion: 1,
          snapshotSequence: 1,
          threads: options?.location === "archive" ? [] : THREADS,
          archivedThreads: [],
        }),
      getThreadShell: (threadId) =>
        Effect.succeed(THREADS.find((entry) => entry.id === threadId) ?? null),
      getThreadRecords: (threadId) =>
        Effect.succeed({
          thread: { id: threadId },
          runs: [homeRun(2), homeRun(1)],
          // Out of order on purpose: the tool sorts by time.
          messages: [
            message(2, "assistant", "done", 4),
            message(1, "user", "first ask", 1),
            message(2, "user", "fix the bug", 3),
            message(1, "assistant", "first answer", 2),
          ],
        } as never),
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(
          Effect.as({ sequence: 1 } as never),
        ),
      streamDomainEvents: Stream.empty,
    }),
    Layer.mock(ThreadLaunchService)({
      launch: (input) =>
        Ref.update(launched, (recorded) => [...recorded, input]).pipe(
          Effect.as({
            threadId: input.threadId!,
            projection: { thread: { branch: null, worktreePath: null } },
            resumed: false,
          } as never),
        ),
    }),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        defaultModelSelection: null,
        projectSettingsOverrides: {},
      } as never),
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
  return { commands, launched, call, files, membershipCalls };
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
      const launched = yield* Ref.get(harness.launched);
      expect(launched).toHaveLength(1);
      expect(launched[0]).toMatchObject({
        threadId: started.threadId,
        projectId: "p-home",
        workspaceStrategy: { type: "root" },
        initialMessage: { text: "hi" },
      });
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
      expect(read.messages.map((entry) => [entry.role, entry.text])).toEqual([
        ["user", "first ask"],
        ["assistant", "first answer"],
        ["user", "fix the bug"],
        ["assistant", "done"],
      ]);
      const lastTurn = yield* harness.call("read_thread", { threadId: HOME_THREAD, turns: 1 });
      expect(lastTurn.messages.map((entry) => entry.text)).toEqual(["fix the bug", "done"]);
      expect(lastTurn.messages[0]!.createdAt).toBe("2026-09-25T00:00:03.000Z");
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
        "thread.metadata.update",
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
      const launched = yield* Ref.get(harness.launched);
      expect(launched).toHaveLength(1);
      expect(launched[0]).toMatchObject({
        threadId: started.threadId,
        projectId: "p-home",
        title: "Port the parser to the server",
        workspaceStrategy: { type: "root" },
        initialMessage: { text: "Port the parser to the server", attachments: [] },
        createdBy: "agent",
        creationSource: "mcp",
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
      expect(harness.files.get(HOME_TASKS)).toBe(
        `- [ ] Port the parser\n  - thread: ${started.threadId}\n`,
      );
    }),
  );

  it.effect("starts a worktree thread through the same launch as the composer", () =>
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
      const launched = yield* Ref.get(harness.launched);
      expect(launched).toMatchObject([
        {
          threadId: started.threadId,
          projectId: "p-home",
          initialMessage: { text: "Port the parser to the server" },
          // Based on the branch the project's checkout is on.
          workspaceStrategy: { type: "worktree", baseRef: "main" },
        },
        {
          projectId: "p-home",
          initialMessage: { text: "Try it on a branch" },
          workspaceStrategy: { type: "worktree", baseRef: "release", branch: "feat/parser" },
        },
      ]);
      // Without a branch the server names the worktree's branch itself (t3code/<hash>).
      expect(launched[0]!.workspaceStrategy).toEqual({ type: "worktree", baseRef: "main" });
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
      expect(yield* Ref.get(harness.launched)).toEqual([]);
    }),
  );
});

describe("threadStatusOf", () => {
  it("prefers what needs attention, then activity, then settlement", () => {
    expect(threadStatusOf(undefined)).toBe("missing");
    expect(
      threadStatusOf(thread(WORK_THREAD, "p", { deletedAt: at("2026-09-02T00:00:00Z") })),
    ).toBe("missing");
    const pending = (kind: "permission" | "user_input") =>
      thread(WORK_THREAD, "p", {
        status: "waiting",
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request"),
          kind,
          createdAt: at("2026-09-02T00:00:00Z"),
        },
      });
    expect(threadStatusOf(pending("permission"))).toBe("needs-approval");
    expect(threadStatusOf(pending("user_input"))).toBe("needs-input");
    expect(threadStatusOf(thread(WORK_THREAD, "p", { status: "failed" }))).toBe("failed");
    expect(threadStatusOf(THREADS[1])).toBe("working");
    expect(threadStatusOf(THREADS[2])).toBe("settled");
    expect(
      threadStatusOf(thread(WORK_THREAD, "p", { archivedAt: at("2026-09-01T00:00:00.000Z") })),
    ).toBe("archived");
    expect(threadStatusOf(THREADS[0])).toBe("ready");
  });
});
