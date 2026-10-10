// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationProjectShell,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ManagerRole from "./ManagerRole.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ManagerScope from "../mcp/ManagerScope.ts";
import {
  BrainstormService,
  fallbackManagerProject,
  layerWithManagerScope,
} from "./BrainstormService.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

const project = (id: string, root: string): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title: NodePath.basename(root),
  workspaceRoot: root,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const thread = (
  id: string,
  projectId: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  createdBy: "user",
  creationSource: "web",
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
  title: `Thread ${id}`,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
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

let home: string;
let previousHome: string | undefined;
beforeEach(() => {
  // Code profiles are read from `~/code`; each test gets its own home.
  previousHome = process.env.HOME;
  home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "brainstorm-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = previousHome;
  NodeFS.rmSync(home, { recursive: true, force: true });
});

let uuidCounter = 0;
const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).map((_, index) => (index + uuidCounter++) % 256),
  digest: (_algorithm, data) => Effect.succeed(data),
});

/** A service on in-memory projects and threads that records every launch and command. */
const makeHarness = Effect.fn("makeBrainstormServiceHarness")(function* (input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  /** Assistant answers by run ordinal, oldest first; one thread is enough here. */
  readonly answersByRun?: ReadonlyArray<ReadonlyArray<{ text: string; streaming?: boolean }>>;
  readonly statusReport?: { readonly text: string; readonly updatedAt: string };
}) {
  const projects = yield* Ref.make(input.projects);
  const threads = yield* Ref.make(input.threads);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const baseDir = NodeFS.mkdtempSync(NodePath.join(home, "t3-"));

  const deps = Layer.mergeAll(
    ServerConfig.layerTest(home, baseDir),
    ServerSettings.layerTest(),
    Layer.succeed(Crypto.Crypto, testCrypto),
    Layer.mock(ProjectService.ProjectService)({
      listShells: () => Ref.get(projects),
      create: (created) =>
        Ref.update(projects, (current) => [
          ...current,
          project(created.projectId ?? "created", created.workspaceRoot),
        ]).pipe(Effect.as({} as never)),
      getShell: (projectId) =>
        Ref.get(projects).pipe(
          Effect.map((current) =>
            Option.fromNullishOr(current.find((candidate) => candidate.id === projectId)),
          ),
        ),
    }),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (launch) =>
        Ref.update(threads, (current) => [
          ...current,
          thread(launch.threadId ?? "launched", launch.projectId, { title: launch.title ?? "" }),
        ]).pipe(Effect.as({} as never)),
    }),
    Layer.mock(OrchestratorV2)({
      getShellSnapshot: () =>
        Ref.get(threads).pipe(
          Effect.map((current) => ({
            schemaVersion: 1,
            snapshotSequence: 0,
            threads: current,
            archivedThreads: [],
          })),
        ),
      getThreadShell: (threadId) =>
        Ref.get(threads).pipe(
          Effect.map((current) => current.find((candidate) => candidate.id === threadId) ?? null),
        ),
      getThreadRecords: ((
        threadId: ThreadId,
        fields: ReadonlyArray<string>,
        filter?: {
          readonly messageRunIds?: ReadonlyArray<string>;
        },
      ) => {
        const runs = (input.answersByRun ?? []).map((_, index) => ({
          id: RunId.make(`run-${index + 1}`),
          ordinal: index + 1,
          // Run n starts at hour n of the day.
          requestedAt: at(`2026-10-06T0${index + 1}:00:00.000Z`),
          startedAt: null,
        }));
        if (fields.includes("runs")) {
          const thread = input.statusReport ? { statusReport: input.statusReport } : {};
          return Effect.succeed({ thread, runs } as never);
        }
        const run = runs.find((candidate) => filter?.messageRunIds?.includes(candidate.id));
        const answers = run ? (input.answersByRun?.[run.ordinal - 1] ?? []) : [];
        return Effect.succeed({
          thread: {},
          messages: answers.map((answer, index) => ({
            threadId,
            runId: run?.id ?? null,
            role: "assistant",
            text: answer.text,
            streaming: answer.streaming ?? false,
            createdAt: at(`2026-10-06T10:0${index}:00.000Z`),
          })),
        } as never);
      }) as never,
      dispatch: (command) =>
        Ref.update(commands, (current) => [...current, command]).pipe(Effect.as({} as never)),
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  const services = yield* Layer.build(layerWithManagerScope.pipe(Layer.provide(deps)));
  const brainstorm = Context.get(services, BrainstormService);
  const managerScope = Effect.succeed(Context.get(services, ManagerScope.ManagerScope));
  const pins = Ref.get(commands).pipe(
    Effect.map((current) =>
      current.flatMap((command) => (command.type === "thread.pin" ? [command.threadId] : [])),
    ),
  );
  return { brainstorm, threads, pins, baseDir, managerScope };
});

describe("BrainstormService managers", () => {
  /** Two code profiles with brains, each with an app project; `home` sorts first, so it is the default. */
  const twoProfiles = () => {
    const homeBrain = NodePath.join(home, "code", "home", "home-brain");
    const workBrain = NodePath.join(home, "code", "work", "work-brain");
    const homeApp = NodePath.join(home, "code", "home", "app");
    const workApp = NodePath.join(home, "code", "work", "app");
    for (const directory of [homeBrain, workBrain, homeApp, workApp]) {
      NodeFS.mkdirSync(directory, { recursive: true });
    }
    return {
      homeBrain,
      workBrain,
      projects: [
        project("p-home-brain", homeBrain),
        project("p-work-brain", workBrain),
        project("p-home-app", homeApp),
        project("p-work-app", workApp),
      ],
    };
  };

  it.effect("each profile gets its own manager in its brain, pinned once and kept", () =>
    Effect.gen(function* () {
      const { homeBrain, workBrain, projects } = twoProfiles();
      const harness = yield* makeHarness({ projects, threads: [] });

      // All without a profile opens the default profile's manager.
      const homeManager = yield* harness.brainstorm.open({ spaceId: "all" });
      expect(homeManager.projectId).toBe("p-home-brain");
      expect(homeManager.brainPath).toBe(homeBrain);
      const workManager = yield* harness.brainstorm.open({ spaceId: "all", profile: "work" });
      expect(workManager.projectId).toBe("p-work-brain");
      expect(workManager.brainPath).toBe(workBrain);
      expect(workManager.threadId).not.toBe(homeManager.threadId);
      const titles = (yield* Ref.get(harness.threads)).map((candidate) => candidate.title);
      expect(titles).toEqual(["Manager · home", "Manager · work"]);
      expect(yield* harness.pins).toEqual([homeManager.threadId, workManager.threadId]);

      const again = yield* harness.brainstorm.open({ spaceId: "all", profile: "work" });
      expect(again.threadId).toBe(workManager.threadId);
      expect(yield* harness.pins).toEqual([homeManager.threadId, workManager.threadId]);

      const state = Option.getOrThrow(yield* Stream.runHead(harness.brainstorm.stateChanges));
      expect(state.managerThreadIdsByProfile).toEqual({
        home: homeManager.threadId,
        work: workManager.threadId,
      });
      expect(state.hiddenThreadIds).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("the manager from before per-profile managers stays its brain profile's manager", () =>
    Effect.gen(function* () {
      const brain = NodePath.join(home, "code", "home", "home-brain");
      const harness = yield* makeHarness({
        projects: [project("p-brain", brain)],
        threads: [thread("t-work", "p-brain")],
      });
      // No brain yet: the single manager starts in the project used most recently.
      const legacy = yield* harness.brainstorm.open({ spaceId: "all" });
      expect(legacy.projectId).toBe("p-brain");

      NodeFS.mkdirSync(brain, { recursive: true });
      const adopted = yield* harness.brainstorm.open({ spaceId: "all", profile: "home" });
      expect(adopted.threadId).toBe(legacy.threadId);
      expect(yield* harness.pins).toEqual([legacy.threadId]);
      const state = Option.getOrThrow(yield* Stream.runHead(harness.brainstorm.stateChanges));
      expect(state.managerThreadIdsByProfile).toEqual({ home: legacy.threadId });
      expect(state.threadIdsBySpaceId.all).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect("hides brainstorm chats that are not managers", () =>
    Effect.gen(function* () {
      const { projects } = twoProfiles();
      const harness = yield* makeHarness({ projects, threads: [] });
      yield* harness.brainstorm.syncSpaces({
        spaces: [
          { id: "all", name: "All", kind: "all", profile: null },
          { id: "space-ideas", name: "Ideas", kind: "custom", profile: null },
          { id: "other", name: "Other", kind: "other", profile: null },
        ],
        customSpaceIdsByProjectId: {},
      });
      const manager = yield* harness.brainstorm.open({ spaceId: "all" });
      const ideas = yield* harness.brainstorm.open({ spaceId: "space-ideas" });

      const state = Option.getOrThrow(yield* Stream.runHead(harness.brainstorm.stateChanges));
      expect(state.managerThreadIdsByProfile).toEqual({ home: manager.threadId });
      expect(state.hiddenThreadIds).toEqual([ideas.threadId]);
    }).pipe(Effect.scoped),
  );

  it.effect("a manager reads its profile's MANAGER.md, else the default profile's", () =>
    Effect.gen(function* () {
      const { homeBrain, workBrain, projects } = twoProfiles();
      NodeFS.writeFileSync(NodePath.join(homeBrain, "MANAGER.md"), "Shared rules.\n");
      const harness = yield* makeHarness({ projects, threads: [] });
      const role = yield* ManagerRole.ManagerRole;
      const homeManager = yield* harness.brainstorm.open({ spaceId: "all", profile: "home" });
      const workManager = yield* harness.brainstorm.open({ spaceId: "all", profile: "work" });

      const fallback = yield* role.instructionsFor(workManager.threadId);
      expect(fallback?.slice(0, ManagerRole.MANAGER_INSTRUCTIONS.length)).toEqual(
        ManagerRole.MANAGER_INSTRUCTIONS,
      );
      expect(fallback).toContain(ManagerRole.profileScopeInstruction("work"));
      expect(fallback?.at(-1)).toContain("Shared rules.");

      NodeFS.writeFileSync(NodePath.join(workBrain, "MANAGER.md"), "Work rules.\n");
      const own = yield* role.instructionsFor(workManager.threadId);
      expect(own?.at(-1)).toContain("Work rules.");
      expect(own?.join("\n")).not.toContain("Shared rules.");
      expect((yield* role.instructionsFor(homeManager.threadId))?.at(-1)).toContain(
        "Shared rules.",
      );
      expect(yield* role.instructionsFor(ThreadId.make("not-a-manager"))).toBeNull();

      const prompt = ManagerRole.withManagerRole("hi", own ?? []);
      expect(prompt).toMatch(/^<t3_code_manager_role>[\s\S]*<user_request>\nhi\n<\/user_request>$/);
      expect(ManagerRole.withManagerRole("/compact", own ?? [])).toBe("/compact");
    }).pipe(Effect.scoped),
  );

  it.effect("a manager's thread tools reach only its profile's projects", () =>
    Effect.gen(function* () {
      const { projects } = twoProfiles();
      const harness = yield* makeHarness({ projects, threads: [] });
      const workManager = yield* harness.brainstorm.open({ spaceId: "all", profile: "work" });
      const scope = yield* harness.managerScope;

      const reach = yield* scope.reachableProjectIds(workManager.threadId);
      expect([...(reach ?? [])].toSorted()).toEqual(["p-work-app", "p-work-brain"]);
      expect(yield* scope.reachableProjectIds(ThreadId.make("not-a-manager"))).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.effect("starts without a brain in the most recently used project and stays there", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        projects: [project("p-old", "/work/old"), project("p-new", "/work/new")],
        threads: [
          thread("t-old", "p-old", { updatedAt: at("2026-09-01T00:00:00.000Z") }),
          thread("t-new", "p-new", { updatedAt: at("2026-10-01T00:00:00.000Z") }),
        ],
      });

      const first = yield* harness.brainstorm.open({ spaceId: "all" });
      expect(first.projectId).toBe("p-new");
      expect(first.brainPath).toBe("/work/new");
      const created = (yield* Ref.get(harness.threads)).find(
        (candidate) => candidate.id === first.threadId,
      );
      expect(created?.title).toBe("Manager");

      // Activity elsewhere does not move the manager.
      yield* Ref.update(harness.threads, (current) => [
        ...current,
        thread("t-later", "p-old", { updatedAt: at("2026-10-05T00:00:00.000Z") }),
      ]);
      const second = yield* harness.brainstorm.open({ spaceId: "all" });
      expect(second.threadId).toBe(first.threadId);
      // That manager reaches every project.
      const reach = yield* (yield* harness.managerScope).reachableProjectIds(first.threadId);
      expect([...(reach ?? [])].toSorted()).toEqual(["p-new", "p-old"]);
    }).pipe(Effect.scoped),
  );
});

describe("BrainstormService threadReport", () => {
  it.effect("returns the newest answer, looking past a run that has none yet", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        projects: [],
        threads: [],
        answersByRun: [
          [{ text: "old report" }],
          [{ text: "progress" }, { text: "## Done\n- final report" }],
          [{ text: "" }, { text: "still typing", streaming: true }],
        ],
      });
      const report = yield* harness.brainstorm.threadReport(ThreadId.make("t"));
      expect(report).toEqual({
        threadId: "t",
        runId: "run-2",
        text: "## Done\n- final report",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("prefers the status the agent set during or after the reporting run", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        projects: [],
        threads: [],
        answersByRun: [[{ text: "first report" }], [{ text: "second report" }]],
        statusReport: { text: "## Status\n- set in run 2", updatedAt: "2026-10-06T02:30:00.000Z" },
      });
      expect(yield* harness.brainstorm.threadReport(ThreadId.make("t"))).toEqual({
        threadId: "t",
        runId: "run-2",
        text: "## Status\n- set in run 2",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("lets a newer run's answer replace an older status", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        projects: [],
        threads: [],
        answersByRun: [[{ text: "first report" }], [{ text: "second report" }]],
        statusReport: { text: "set in run 1", updatedAt: "2026-10-06T01:30:00.000Z" },
      });
      expect((yield* harness.brainstorm.threadReport(ThreadId.make("t"))).text).toBe(
        "second report",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("has no text before the first answer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ projects: [], threads: [], answersByRun: [] });
      expect(yield* harness.brainstorm.threadReport(ThreadId.make("t"))).toEqual({
        threadId: "t",
        runId: null,
        text: null,
      });
    }).pipe(Effect.scoped),
  );
});

describe("fallbackManagerProject", () => {
  it("picks the project with the newest thread, else the first project", () => {
    const projects = [project("a", "/a"), project("b", "/b")];
    expect(
      fallbackManagerProject(projects, [
        { projectId: ProjectId.make("a"), updatedAt: at("2026-01-01T00:00:00.000Z") },
        { projectId: ProjectId.make("b"), updatedAt: at("2026-02-01T00:00:00.000Z") },
      ])?.id,
    ).toBe("b");
    expect(fallbackManagerProject(projects, [])?.id).toBe("a");
    expect(fallbackManagerProject([], [])).toBeUndefined();
  });
});
