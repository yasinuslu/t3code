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
import { BrainstormService, fallbackManagerProject, layer } from "./BrainstormService.ts";

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
        }));
        if (fields.includes("runs")) return Effect.succeed({ thread: {}, runs } as never);
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

  const services = yield* Layer.build(layer.pipe(Layer.provide(deps)));
  const brainstorm = Context.get(services, BrainstormService);
  const pins = Ref.get(commands).pipe(
    Effect.map((current) =>
      current.flatMap((command) => (command.type === "thread.pin" ? [command.threadId] : [])),
    ),
  );
  return { brainstorm, threads, pins, baseDir };
});

describe("BrainstormService manager thread", () => {
  it.effect("creates the manager in the brain project, pins it once and keeps it", () =>
    Effect.gen(function* () {
      const brain = NodePath.join(home, "code", "home", "home-brain");
      NodeFS.mkdirSync(brain, { recursive: true });
      const harness = yield* makeHarness({
        projects: [project("p-app", "/work/app"), project("p-brain", brain)],
        threads: [],
      });

      const first = yield* harness.brainstorm.open("all");
      expect(first.projectId).toBe("p-brain");
      expect(first.brainPath).toBe(brain);
      const created = (yield* Ref.get(harness.threads)).find(
        (candidate) => candidate.id === first.threadId,
      );
      expect(created?.title).toBe("Manager");
      expect(yield* harness.pins).toEqual([first.threadId]);

      // Opening again returns the same thread without pinning it again.
      const second = yield* harness.brainstorm.open("all");
      expect(second.threadId).toBe(first.threadId);
      expect(yield* harness.pins).toEqual([first.threadId]);
    }).pipe(Effect.scoped),
  );

  it.effect("lists the manager as an ordinary thread and hides other brainstorm chats", () =>
    Effect.gen(function* () {
      const brain = NodePath.join(home, "code", "home", "home-brain");
      NodeFS.mkdirSync(brain, { recursive: true });
      const harness = yield* makeHarness({
        projects: [project("p-brain", brain)],
        threads: [],
      });
      yield* harness.brainstorm.syncSpaces({
        spaces: [
          { id: "all", name: "All", kind: "all", profile: null },
          { id: "space-home", name: "home", kind: "profile", profile: "home" },
          { id: "other", name: "Other", kind: "other", profile: null },
        ],
        customSpaceIdsByProjectId: {},
      });
      const manager = yield* harness.brainstorm.open("all");
      const homeChat = yield* harness.brainstorm.open("space-home");

      const state = Option.getOrThrow(yield* Stream.runHead(harness.brainstorm.stateChanges));
      expect(state.threadIdsBySpaceId.all).toBe(manager.threadId);
      expect(state.hiddenThreadIds).toEqual([homeChat.threadId]);
    }).pipe(Effect.scoped),
  );

  it.effect("the manager knows its role and the user's MANAGER.md; other chats do not", () =>
    Effect.gen(function* () {
      const brain = NodePath.join(home, "code", "home", "home-brain");
      NodeFS.mkdirSync(brain, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(brain, "MANAGER.md"), "Launch new work on the desk.\n");
      const harness = yield* makeHarness({ projects: [project("p-brain", brain)], threads: [] });
      yield* harness.brainstorm.syncSpaces({
        spaces: [
          { id: "all", name: "All", kind: "all", profile: null },
          { id: "space-home", name: "home", kind: "profile", profile: "home" },
        ],
        customSpaceIdsByProjectId: {},
      });
      const manager = yield* harness.brainstorm.open("all");
      const homeChat = yield* harness.brainstorm.open("space-home");
      const role = yield* ManagerRole.ManagerRole;

      const instructions = yield* role.instructionsFor(manager.threadId);
      expect(instructions?.slice(0, -1)).toEqual(ManagerRole.MANAGER_INSTRUCTIONS);
      expect(instructions?.at(-1)).toContain("Launch new work on the desk.");
      expect(yield* role.instructionsFor(homeChat.threadId)).toBeNull();

      const prompt = ManagerRole.withManagerRole("hi", instructions ?? []);
      expect(prompt).toMatch(/^<t3_code_manager_role>[\s\S]*<user_request>\nhi\n<\/user_request>$/);
      expect(ManagerRole.withManagerRole("/compact", instructions ?? [])).toBe("/compact");
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

      const first = yield* harness.brainstorm.open("all");
      expect(first.projectId).toBe("p-new");
      expect(first.brainPath).toBe("/work/new");

      // Activity elsewhere does not move the manager.
      yield* Ref.update(harness.threads, (current) => [
        ...current,
        thread("t-later", "p-old", { updatedAt: at("2026-10-05T00:00:00.000Z") }),
      ]);
      const second = yield* harness.brainstorm.open("all");
      expect(second.threadId).toBe(first.threadId);
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
