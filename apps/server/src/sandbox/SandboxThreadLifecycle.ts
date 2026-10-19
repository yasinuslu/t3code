import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SandboxService from "./SandboxService.ts";

/**
 * Follows threads through their lifecycle for their sandbox: a deleted
 * thread leaves its sandbox, which is deleted with the last thread that used
 * it, and archived or settled threads release their VM. Separate from
 * SandboxService, which the orchestrator depends on.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sandboxes = yield* Effect.serviceOption(SandboxService.SandboxService);
    if (Option.isNone(sandboxes)) return;
    const service = sandboxes.value;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.streamDomainEvents.pipe(
      Stream.runForEach((event) => {
        switch (event.type) {
          case "thread.deleted":
            return service.detach(event.threadId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not remove a deleted thread's sandbox", {
                  threadId: event.threadId,
                  cause,
                }),
              ),
            );
          case "thread.archived":
          case "thread.settled":
            return service.retire(event.threadId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not release a closed thread's sandbox", {
                  threadId: event.threadId,
                  cause,
                }),
              ),
            );
          case "thread.unarchived":
          case "thread.unsettled":
            return Effect.sync(() => service.unretire(event.threadId));
          default:
            return Effect.void;
        }
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning("Sandbox thread lifecycle stopped", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);
