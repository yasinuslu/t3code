import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as PeerEnvironments from "../../../peers/PeerEnvironments.ts";
import * as ManagerScope from "../../ManagerScope.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { PeersToolkitHandlersLive } from "./handlers.ts";
import { PeersToolkit } from "./tools.ts";

const MANAGER = ThreadId.make("thread-manager");
const WORKER = ThreadId.make("thread-worker");

const callPeerList = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const peers = Layer.mock(PeerEnvironments.PeerEnvironments)({
      status: Effect.succeed([
        {
          name: "laptop",
          url: "http://laptop:3773",
          reachable: false,
          label: null,
          environmentId: null,
          serverVersion: null,
        },
      ]),
    });
    const toolkit = yield* PeersToolkit.pipe(
      Effect.provide(PeersToolkitHandlersLive.pipe(Layer.provide(peers))),
    );
    return yield* toolkit.handle("t3_peer_list", {}).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)!.result),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        capabilities: new Set(["orchestration"] as const),
        issuedAt: 1,
      }),
      Effect.provideService(ManagerScope.ManagerScope, {
        reachableProjectIds: (candidate) =>
          Effect.succeed(candidate === MANAGER ? new Set() : null),
      }),
      Effect.provide(peers),
    );
  });

describe("peer toolkit", () => {
  it.effect("reaches peers only from the manager thread", () =>
    Effect.gen(function* () {
      expect(yield* callPeerList(MANAGER)).toMatchObject({
        peers: [{ name: "laptop", reachable: false }],
      });
      expect(yield* callPeerList(WORKER)).toMatchObject({
        _tag: "OrchestratorMcpFailure",
        code: "capability_denied",
      });
    }),
  );
});
