import {
  type BrainstormSpace,
  BrainstormError,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationProjectShell,
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
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
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

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const makeHarness = Effect.fn("makeBrainstormHarness")(function* (
  initialFiles: Record<string, string> = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
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
        const file = parseTaskMarkdown(path === null ? "" : (files.get(path) ?? ""));
        return {
          spaceId: space.id,
          spaceName: space.name,
          path,
          profile: space.kind === "profile" ? space.profile : null,
          goals: file.goals.map(({ number, title, done, notes }) => ({
            number,
            title,
            done,
            notes,
          })),
          tasks: file.tasks,
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
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(
          Effect.as({ sequence: 1 } as never),
        ),
      streamDomainEvents: Stream.empty,
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
  it.effect("the manager gets its operating rules and every profile's brain", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const manager = yield* harness.call("manager_overview", {}, BRAINSTORM_ALL);
      expect(manager).toMatchObject({ isManager: true, spaceId: "all", seesEverything: true });
      expect(manager.instructions.length).toBeGreaterThan(0);
      expect(manager.profiles).toEqual([
        {
          profile: "home",
          space: "home",
          brainPath: "/code/home/home-brain",
          taskFile: HOME_TASKS,
          projects: ["t3code", "home-brain"],
        },
        {
          profile: "work",
          space: "work",
          brainPath: "/code/work/work-brain",
          taskFile: WORK_TASKS,
          projects: ["api"],
        },
      ]);
      const regular = yield* harness.call("manager_overview", {}, WORK_THREAD);
      expect(regular).toMatchObject({ isManager: false, instructions: [], spaceId: "all" });
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

  it.effect("the manager must name the brain it writes to", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [HOME_TASKS]: "- [ ] home task\n" });
      const error = yield* harness
        .call("add_goal", { title: "Ship it" }, BRAINSTORM_ALL)
        .pipe(Effect.flip);
      expect(error.message).toContain("Pass space");
      const taskError = yield* harness
        .call("add_task", { title: "loose" }, BRAINSTORM_ALL)
        .pipe(Effect.flip);
      expect(taskError.message).toContain("Pass space");
      expect(harness.files.get(HOME_TASKS)).toBe("- [ ] home task\n");
      expect(harness.files.has(WORK_TASKS)).toBe(false);

      yield* harness.call("add_goal", { title: "Ship it", space: "work" }, BRAINSTORM_ALL);
      expect(harness.files.get(WORK_TASKS)).toBe("## Ship it\n");
      expect(harness.files.get(HOME_TASKS)).toBe("- [ ] home task\n");
    }),
  );

  it.effect("plans a goal: tasks under it, linked threads, done", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ [WORK_TASKS]: "- [ ] loose idea\n" });
      const goal = yield* harness.call(
        "add_goal",
        { title: "Faster builds", notes: ["Done when CI < 5 min"], space: "work" },
        BRAINSTORM_ALL,
      );
      expect(goal).toEqual({ space: "work", number: 2, path: WORK_TASKS });
      yield* harness.call(
        "add_task",
        { title: "Cache deps", goal: "faster", space: "work" },
        BRAINSTORM_ALL,
      );
      yield* harness.call(
        "update_task",
        { task: "Cache deps", linkThreadIds: [WORK_THREAD], space: "work" },
        BRAINSTORM_ALL,
      );
      yield* harness.call(
        "update_task",
        { task: "loose idea", goal: "Faster builds", space: "work" },
        BRAINSTORM_ALL,
      );
      expect(harness.files.get(WORK_TASKS)).toBe(
        [
          "## Faster builds",
          "Done when CI < 5 min",
          "",
          "- [ ] Cache deps",
          `  - thread: ${WORK_THREAD}`,
          "- [ ] loose idea",
          "",
        ].join("\n"),
      );

      const listed = yield* harness.call("list_tasks", {}, BRAINSTORM_ALL);
      expect(listed.lists).toHaveLength(1);
      expect(listed.lists[0]).toMatchObject({ space: "work", profile: "work", path: WORK_TASKS });
      expect(listed.lists[0]!.goals).toEqual([
        {
          number: 1,
          title: "Faster builds",
          done: false,
          notes: ["Done when CI < 5 min"],
          tasks: [
            {
              number: 1,
              title: "Cache deps",
              done: false,
              notes: [],
              goal: "Faster builds",
              threads: [{ threadId: WORK_THREAD, title: `Thread ${WORK_THREAD}`, status: "ready" }],
            },
            {
              number: 2,
              title: "loose idea",
              done: false,
              notes: [],
              goal: "Faster builds",
              threads: [],
            },
          ],
        },
      ]);

      const done = yield* harness.call(
        "update_goal",
        { goal: 1, done: true, space: "work" },
        BRAINSTORM_ALL,
      );
      expect(done).toMatchObject({ title: "Faster builds", done: true });
      expect(harness.files.get(WORK_TASKS)!.startsWith("## [x] Faster builds\n")).toBe(true);
      const hidden = yield* harness.call("list_tasks", { space: "work" }, BRAINSTORM_ALL);
      expect(hidden.lists[0]!.goals).toEqual([]);
      const shown = yield* harness.call(
        "list_tasks",
        { space: "work", includeDone: true },
        BRAINSTORM_ALL,
      );
      expect(shown.lists[0]!.goals.map((entry) => entry.title)).toEqual(["Faster builds"]);
    }),
  );

  it.effect("deletes only empty goals", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        [HOME_TASKS]: "## Busy\n- [ ] work\n\n## Empty\nSome note\n",
      });
      const error = yield* harness.call("delete_goal", { goal: "Busy" }).pipe(Effect.flip);
      expect(error.message).toContain("still has 1 task");
      yield* harness.call("delete_goal", { goal: "Empty" });
      expect(harness.files.get(HOME_TASKS)).toBe("## Busy\n- [ ] work\n\n");
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
      expect(completed).toMatchObject({ number: 2, title: "Fix X", done: true, goal: "Inbox" });

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

  it.effect("the manager sees every list and writes where it is told", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        [HOME_TASKS]: "- [ ] home task\n",
        [WORK_TASKS]: "- [x] work task\n  - thread: thread-work\n",
      });
      const listed = yield* harness.call("list_tasks", {}, BRAINSTORM_ALL);
      expect(
        listed.lists.map((list) => [
          list.space,
          list.goals.flatMap((goal) => goal.tasks.map((task) => task.title)),
        ]),
      ).toEqual([
        ["work", ["work task"]],
        ["home", ["home task"]],
      ]);
      expect(listed.lists[0]!.goals[0]!.tasks[0]!.threads).toEqual([
        { threadId: "thread-work", title: "Thread thread-work", status: "ready" },
      ]);
      yield* harness.call("add_task", { title: "side", space: "Side Quests" }, BRAINSTORM_ALL);
      expect(harness.files.get("/code/home/home-brain/tasks/side-quests.md")).toBe(
        "## Inbox\n- [ ] side\n",
      );
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
