import { type OrchestrationCommand, OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

type ThreadTurnStartCommand = Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

type Dispatch = (
  command: ThreadTurnStartCommand,
) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;

/**
 * Lets server-side callers, such as the brainstorm MCP tools, start a thread
 * through the same `thread.turn.start` bootstrap (worktree, setup script,
 * setup card) that clients use. That bootstrap lives in each WebSocket
 * connection's RPC layer, which registers its dispatcher here while it is
 * open. The bootstrap itself outlives the connection that ran it.
 */
export class ThreadBootstrapDispatcher extends Context.Service<
  ThreadBootstrapDispatcher,
  {
    readonly register: (dispatch: Dispatch) => Effect.Effect<void, never, Scope.Scope>;
    /** Fails when no client is connected. */
    readonly dispatch: Dispatch;
  }
>()("t3/orchestration/ThreadBootstrapDispatcher") {}

export const make = Effect.sync(() => {
  const dispatchers = new Set<{ readonly dispatch: Dispatch }>();
  return ThreadBootstrapDispatcher.of({
    register: (dispatch) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const entry = { dispatch };
          dispatchers.add(entry);
          return entry;
        }),
        (entry) => Effect.sync(() => dispatchers.delete(entry)),
      ).pipe(Effect.asVoid),
    dispatch: (command) => {
      const latest = [...dispatchers].at(-1);
      return latest
        ? latest.dispatch(command)
        : Effect.fail(
            new OrchestrationDispatchCommandError({
              message: "No T3 Code client is connected to prepare the thread.",
            }),
          );
    },
  });
});

export const layer = Layer.effect(ThreadBootstrapDispatcher, make);
