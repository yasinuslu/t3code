import {
  ThreadContextBreakdownError,
  type ThreadContextBreakdownInput,
  type ThreadContextBreakdownResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

/** Measures a thread's live provider session; never starts one, since that would spend a turn. */
export class ContextBreakdownRequests extends Context.Service<
  ContextBreakdownRequests,
  {
    readonly read: (
      input: ThreadContextBreakdownInput,
    ) => Effect.Effect<ThreadContextBreakdownResult, ThreadContextBreakdownError>;
  }
>()("t3/contextBreakdown/ContextBreakdownRequests") {}

const noSession: ThreadContextBreakdownResult = { _tag: "unavailable", reason: "no-session" };

const make = Effect.gen(function* () {
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

  const read = Effect.fn("ContextBreakdownRequests.read")(function* (
    input: ThreadContextBreakdownInput,
  ) {
    const fail = (cause: unknown) =>
      new ThreadContextBreakdownError({ threadId: input.threadId, cause });
    const records = yield* threadManagement
      .getThreadRecords(input.threadId, ["providerThreads"])
      .pipe(Effect.mapError(fail));
    const providerThread = records.providerThreads.find(
      (candidate) => candidate.id === records.thread.activeProviderThreadId,
    );
    if (providerThread?.providerSessionId == null) return noSession;
    const runtime = Option.getOrUndefined(
      yield* providerSessions.get(providerThread.providerSessionId).pipe(Effect.mapError(fail)),
    );
    if (runtime === undefined) return noSession;
    if (runtime.readContextBreakdown === undefined) {
      return { _tag: "unavailable", reason: "provider-unsupported" } as const;
    }
    return yield* runtime.readContextBreakdown({ providerThread }).pipe(
      Effect.map((breakdown): ThreadContextBreakdownResult => ({ _tag: "available", breakdown })),
      Effect.catchTags({ ProviderAdapterSessionStoppedError: () => Effect.succeed(noSession) }),
      Effect.mapError(fail),
    );
  });

  return ContextBreakdownRequests.of({ read });
});

export const layer = Layer.effect(ContextBreakdownRequests, make);
