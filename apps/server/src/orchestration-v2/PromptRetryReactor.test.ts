import {
  EventId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as PromptRetryReactor from "./PromptRetryReactor.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const THREAD_ID = ThreadId.make("retry-thread");
const RUN_ID = RunId.make("retry-run");
const AT = DateTime.makeUnsafe("2026-10-20T12:00:00.000Z");
const PROMPT = "Show me proof.";

interface Scenario {
  readonly userMessageId?: MessageId;
  readonly failureCode?: string | null;
  /** Runs that exist besides the failed one, newest last. */
  readonly otherRuns?: ReadonlyArray<{ readonly id: RunId; readonly status: string }>;
  readonly settled?: boolean;
}

const makeHarness = Effect.fn("makePromptRetryHarness")(function* (scenario: Scenario) {
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const read = yield* Deferred.make<void>();
  const run = {
    id: RUN_ID,
    threadId: THREAD_ID,
    ordinal: 2,
    providerThreadId: null,
    userMessageId: scenario.userMessageId ?? MessageId.make("message:user"),
    rootNodeId: null,
    status: "failed",
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
  };
  const failureCode =
    scenario.failureCode === undefined ? "prompt_not_run" : (scenario.failureCode ?? null);

  const dependencies = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(domainEvents),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) => {
        dispatched.push(command);
        return Effect.succeed({ sequence: 1, storedEvents: [] });
      },
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadRecords: ((_threadId, fields, filter) =>
        Deferred.succeed(read, undefined).pipe(
          Effect.as(
            (fields as ReadonlyArray<string>).includes("messages")
              ? {
                  messages: [
                    {
                      id: run.userMessageId,
                      text: PROMPT,
                      attachments: [],
                    },
                  ].filter((message) => filter?.messageIds?.includes(message.id)),
                }
              : {
                  thread: {
                    id: THREAD_ID,
                    projectId: ProjectId.make("project:retry"),
                    archivedAt: null,
                    deletedAt: null,
                    settledOverride: scenario.settled === true ? "settled" : null,
                    lineage: { relationshipToParent: null },
                    creationSource: "web",
                  },
                  runs: [
                    run,
                    ...(scenario.otherRuns ?? []).map((other, index) => ({
                      ...run,
                      ...other,
                      ordinal: 3 + index,
                      startedAt: other.status === "queued" ? null : AT,
                      completedAt: null,
                    })),
                  ],
                  turnItems: [
                    {
                      id: "item:error",
                      type: "error",
                      status: "failed",
                      runId: RUN_ID,
                      nodeId: null,
                      ordinal: 1,
                      updatedAt: AT,
                      failure: { class: "provider_error", message: "not run", code: failureCode },
                    },
                  ].filter((item) => filter?.turnItemTypes?.includes(item.type as never) ?? true),
                },
          ),
        )) as ProjectionStore.ProjectionStoreV2Shape["getThreadRecords"],
    }),
  );

  const failRun = Effect.gen(function* () {
    const reactor = yield* PromptRetryReactor.PromptRetryReactor;
    yield* reactor.start();
    yield* Queue.offer(domainEvents, {
      type: "run.updated",
      id: EventId.make("event:failed"),
      threadId: THREAD_ID,
      runId: RUN_ID,
      occurredAt: AT,
      payload: run,
    } as OrchestrationV2DomainEvent);
    yield* Deferred.await(read);
    yield* reactor.drain;
  }).pipe(
    Effect.provide(
      PromptRetryReactor.layerWithBackoff([0, 0, 0]).pipe(Layer.provide(dependencies)),
    ),
  );

  return { failRun, dispatched };
});

describe("PromptRetryReactor", () => {
  it.effect("sends a message the provider did not run again, as a new message", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({});
      yield* fixture.failRun;

      const [resent, notice] = fixture.dispatched;
      assert.equal(resent?.type, "message.dispatch");
      if (resent?.type === "message.dispatch") {
        assert.equal(resent.text, PROMPT);
        assert.match(resent.messageId, /^prompt-retry:1:/u);
        assert.notEqual(resent.messageId, MessageId.make("message:user"));
        assert.deepEqual(resent.dispatchMode, { type: "start_immediately" });
      }
      assert.equal(notice?.type, "thread.run-notice.record");
      if (notice?.type === "thread.run-notice.record") {
        assert.equal(
          notice.message,
          "The provider did not run this message, so it was sent again (1 of 3).",
        );
      }
    }),
  );

  it.effect("counts the resends in a chain and stops after the last one", () =>
    Effect.gen(function* () {
      const second = yield* makeHarness({ userMessageId: MessageId.make("prompt-retry:1:abc") });
      yield* second.failRun;
      const resent = second.dispatched[0];
      assert.match(
        resent?.type === "message.dispatch" ? resent.messageId : "",
        /^prompt-retry:2:/u,
      );

      const last = yield* makeHarness({ userMessageId: MessageId.make("prompt-retry:3:abc") });
      yield* last.failRun;
      assert.deepEqual(
        last.dispatched.map((command) =>
          command.type === "thread.run-notice.record" ? command.signal : command.type,
        ),
        ["prompt-retry-exhausted"],
      );
    }),
  );

  it.effect("leaves a run that failed for another reason alone", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({ failureCode: null });
      yield* fixture.failRun;
      assert.isEmpty(fixture.dispatched);
    }),
  );

  it.effect("does not resend once the user has sent something else", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({
        otherRuns: [{ id: RunId.make("retry-run-2"), status: "queued" }],
      });
      yield* fixture.failRun;
      assert.isEmpty(fixture.dispatched);
    }),
  );

  it.effect("does not resend into a settled thread", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({ settled: true });
      yield* fixture.failRun;
      assert.isEmpty(fixture.dispatched);
    }),
  );
});
