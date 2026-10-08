import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as PeerEnvironments from "./PeerEnvironments.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const model = (name: string) => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: name,
});

const project = (
  id: string,
  title: string,
  defaultModelSelection: OrchestrationProjectShell["defaultModelSelection"] = null,
): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title,
  workspaceRoot: `/code/${title}`,
  defaultModelSelection,
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
  modelSelection: model("opus"),
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

const ENVIRONMENT = EnvironmentId.make("peer-env");

describe("peer urls", () => {
  it("normalizes http(s) base urls and rejects anything else", () => {
    expect(PeerEnvironments.normalizePeerUrl(" http://host:3773/ ")).toBe("http://host:3773");
    expect(PeerEnvironments.normalizePeerUrl("https://t3.example.test/base//")).toBe(
      "https://t3.example.test/base",
    );
    expect(PeerEnvironments.normalizePeerUrl("ftp://host")).toBeNull();
    expect(PeerEnvironments.normalizePeerUrl("http://user:secret@host")).toBeNull();
    expect(PeerEnvironments.normalizePeerUrl("not a url")).toBeNull();
  });

  it("speaks the current orchestration protocol over ws or wss", () => {
    expect(PeerEnvironments.peerSocketUrl("http://host:3773")).toBe(
      "ws://host:3773/ws?orchestrationProtocol=2&clientSurface=web",
    );
    expect(PeerEnvironments.peerSocketUrl("https://t3.example.test/base")).toBe(
      "wss://t3.example.test/base/ws?orchestrationProtocol=2&clientSurface=web",
    );
  });
});

describe("peer snapshot views", () => {
  const snapshot = {
    projects: [project("p-app", "app")],
    threads: [
      thread("old", "p-app", { updatedAt: at("2026-09-10T00:00:00.000Z") }),
      thread("busy", "p-app", {
        updatedAt: at("2026-09-25T00:00:00.000Z"),
        status: "running",
        activeRunId: RunId.make("run-1"),
      }),
      thread("child", "p-app", {
        updatedAt: at("2026-09-30T00:00:00.000Z"),
        lineage: {
          parentThreadId: ThreadId.make("busy"),
          relationshipToParent: "subagent",
          rootThreadId: ThreadId.make("busy"),
        },
      }),
      thread("hidden", "p-app", { archivedAt: at("2026-09-29T00:00:00.000Z") }),
      thread("lost", "p-gone", { updatedAt: at("2026-09-15T00:00:00.000Z") }),
    ],
  };

  it("lists top-level live threads, latest first, with status and a peer link", () => {
    const entries = PeerEnvironments.peerThreadEntries(snapshot, ENVIRONMENT, 10);
    expect(entries.map((entry) => [entry.threadId, entry.status, entry.project])).toEqual([
      ["busy", "working", "app"],
      ["lost", "ready", "p-gone"],
      ["old", "ready", "app"],
    ]);
    expect(entries[0]?.link).toBe("[Thread busy](t3code://threads/peer-env/busy)");
    expect(PeerEnvironments.peerThreadEntries(snapshot, ENVIRONMENT, 1)).toHaveLength(1);
  });

  it("launches with the project's default model, else its latest thread's", () => {
    expect(
      PeerEnvironments.defaultLaunchModel(
        { projects: [project("p-app", "app", model("sonnet"))], threads: snapshot.threads },
        "p-app",
      ),
    ).toEqual(model("sonnet"));
    expect(
      PeerEnvironments.defaultLaunchModel(
        {
          projects: snapshot.projects,
          threads: [
            thread("a", "p-app", { modelSelection: model("haiku") }),
            thread("b", "p-app", {
              modelSelection: model("opus-latest"),
              updatedAt: at("2026-09-28T00:00:00.000Z"),
            }),
          ],
        },
        "p-app",
      ),
    ).toEqual(model("opus-latest"));
    expect(PeerEnvironments.defaultLaunchModel({ ...snapshot, threads: [] }, "p-app")).toBeNull();
  });

  it("builds the workspace strategy, requiring a base ref for worktrees", () => {
    expect(PeerEnvironments.launchWorkspaceStrategy({})).toEqual({ type: "root" });
    expect(PeerEnvironments.launchWorkspaceStrategy({ workspace: "worktree" })).toBeNull();
    expect(
      PeerEnvironments.launchWorkspaceStrategy({
        workspace: "worktree",
        baseRef: "main",
        branch: "feature/x",
      }),
    ).toEqual({ type: "worktree", baseRef: "main", branch: "feature/x" });
  });

  it("keeps the last messages and cuts long ones", () => {
    const message = (text: string) => ({
      role: "assistant" as const,
      text,
      createdAt: at("2026-09-20T00:00:00.000Z"),
    });
    const messages = PeerEnvironments.peerMessages(
      {
        messages: [message("one"), message("two"), message("x".repeat(5_000))] as never,
      },
      2,
    );
    expect(messages.map((entry) => [entry.text.length, entry.truncated])).toEqual([
      [3, false],
      [4_000, true],
    ]);
  });
});

describe("peer store", () => {
  const harness = () => {
    let stored: Uint8Array | null = null;
    const secrets = Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: () => Effect.sync(() => Option.fromNullishOr(stored)),
      set: (_name, value) =>
        Effect.sync(() => {
          stored = value;
        }),
      remove: () =>
        Effect.sync(() => {
          stored = null;
        }),
    });
    return {
      stored: () => (stored === null ? null : new TextDecoder().decode(stored)),
      layer: PeerEnvironments.layer.pipe(
        Layer.provide(Layer.mergeAll(secrets, FetchHttpClient.layer, NodeServices.layer)),
      ),
    };
  };

  it.effect("adds, replaces by name and removes peers without exposing tokens", () => {
    const { stored, layer } = harness();
    return Effect.gen(function* () {
      const peers = yield* PeerEnvironments.PeerEnvironments;
      yield* peers.add({ name: "laptop", url: "http://laptop:3773/", token: "one" });
      yield* peers.add({ name: "box", url: "https://box.example.test", token: "two" });
      yield* peers.add({ name: "laptop", url: "http://laptop:4000", token: "three" });
      expect(yield* peers.list).toEqual([
        { name: "laptop", url: "http://laptop:4000" },
        { name: "box", url: "https://box.example.test" },
      ]);
      expect(stored()).toContain('"token":"three"');
      expect(stored()).not.toContain('"token":"one"');

      const invalid = yield* peers.add({ name: "x", url: "ftp://x", token: "t" }).pipe(Effect.flip);
      expect(invalid._tag).toBe("PeerInvalidUrlError");

      expect(yield* peers.remove("laptop")).toBe(true);
      expect(yield* peers.remove("laptop")).toBe(false);
      expect(yield* peers.remove("box")).toBe(true);
      expect(stored()).toBeNull();

      const missing = yield* peers.threads("laptop", { limit: 5 }).pipe(Effect.flip);
      expect(missing._tag).toBe("PeerNotFoundError");
    }).pipe(Effect.provide(layer));
  });
});
