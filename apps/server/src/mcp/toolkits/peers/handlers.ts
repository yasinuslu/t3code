import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PeerEnvironments from "../../../peers/PeerEnvironments.ts";
import * as ManagerScope from "../../ManagerScope.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { PeersToolkit } from "./tools.ts";

const toFailure = (error: PeerEnvironments.PeerError) =>
  new OrchestratorMcpFailure({
    code:
      error._tag === "PeerNotFoundError" || error._tag === "PeerInvalidUrlError"
        ? "invalid_request"
        : error._tag === "PeerUnreachableError"
          ? "provider_unavailable"
          : "orchestration_error",
    message: error.message,
  });

/** Reaching other servers is a manager's job; every other thread stays on this server. */
const managerOnly = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const scope = yield* ManagerScope.ManagerScope;
    if ((yield* scope.reachableProjectIds(invocation.threadId)) === null) {
      return yield* new OrchestratorMcpFailure({
        code: "capability_denied",
        message: "Peer tools are for the manager thread.",
      });
    }
    return yield* effect;
  });

const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(1, value ?? fallback), max);

export const PeersToolkitHandlersLive = PeersToolkit.toLayer(
  Effect.gen(function* () {
    const peers = yield* PeerEnvironments.PeerEnvironments;
    return {
      t3_peer_list: () =>
        managerOnly(
          peers.status.pipe(
            Effect.map((statuses) => ({ peers: statuses })),
            Effect.mapError(toFailure),
          ),
        ),
      t3_peer_thread_list: ({ peer, limit }) =>
        managerOnly(
          peers.threads(peer, { limit: clamp(limit, 30, 200) }).pipe(
            Effect.map((threads) => ({ threads })),
            Effect.mapError(toFailure),
          ),
        ),
      t3_peer_project_list: ({ peer }) =>
        managerOnly(
          peers.projects(peer).pipe(
            Effect.map((projects) => ({ projects })),
            Effect.mapError(toFailure),
          ),
        ),
      t3_peer_thread_read: ({ peer, threadId, messages }) =>
        managerOnly(
          peers
            .readThread(peer, threadId, { messages: clamp(messages, 10, 50) })
            .pipe(Effect.mapError(toFailure)),
        ),
      t3_peer_thread_launch: ({ peer, message, ...input }) =>
        managerOnly(
          peers.launch(peer, { ...input, text: message }).pipe(Effect.mapError(toFailure)),
        ),
      t3_peer_thread_send: ({ peer, threadId, message }) =>
        managerOnly(peers.send(peer, threadId, message).pipe(Effect.mapError(toFailure))),
    };
  }),
);
