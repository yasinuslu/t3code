import {
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  type ServerProvider,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import type { RankedAccount, SkippedAccount } from "@t3tools/shared/accountBalancing";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { BrainstormService } from "../brainstorm/BrainstormService.ts";
import * as AccountBalancer from "../provider/AccountBalancer.ts";
import * as AccountFailoverReactor from "./AccountFailoverReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const THREAD_ID = ThreadId.make("failover-thread");
const RUN_ID = RunId.make("failover-run");
const AT = DateTime.makeUnsafe("2026-10-13T12:00:00.000Z");
const NOW = DateTime.toEpochMillis(AT);
const RESET_AT = "2026-10-14T10:00:00.000Z";
const claude = ProviderInstanceId.make("claude");
const claude2 = ProviderInstanceId.make("claude_2");
const codex = ProviderInstanceId.make("codex");
const selection: ModelSelection = { instanceId: claude, model: "claude-opus-5-5" };

function provider(instanceId: ProviderInstanceId, displayName: string): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make(instanceId === codex ? "codex" : "claudeAgent"),
    displayName,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const providers = [
  provider(claude, "Claude"),
  provider(claude2, "Claude 2"),
  provider(codex, "Codex"),
];
const toClaude2: RankedAccount = {
  instance: providers[1]!,
  selection: { ...selection, instanceId: claude2 },
  sameDriver: true,
};
const toCodex: RankedAccount = {
  instance: providers[2]!,
  selection: { instanceId: codex, model: "gpt-6" },
  sameDriver: false,
};

interface Scenario {
  /** The instance the failed run ran on. */
  readonly ranOn?: ProviderInstanceId;
  /** Set when the failed run was itself a failover continuation. */
  readonly userMessageId?: MessageId;
  readonly failure?: "usage_limit" | "transport";
  readonly ranked: ReadonlyArray<RankedAccount>;
  readonly skipped?: ReadonlyArray<SkippedAccount>;
  /** Continuation messages earlier hops already sent. */
  readonly sentMessageIds?: ReadonlyArray<MessageId>;
  readonly manager?: boolean;
  readonly includeManager?: boolean;
  readonly rejectsMoveTo?: ProviderInstanceId;
  /** The run that first hit the limit, when the failed run is a later hop. */
  readonly limitedRun?: { readonly id: RunId; readonly ranOn: ProviderInstanceId };
  /** The failed run called a tool before it failed. */
  readonly worked?: boolean;
}

const makeHarness = Effect.fn("makeAccountFailoverHarness")(function* (scenario: Scenario) {
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const read = yield* Deferred.make<void>();
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const limits: Array<readonly [ProviderInstanceId, string, string | null | undefined]> = [];
  const excluded: Array<ReadonlyArray<ProviderInstanceId>> = [];
  const ranOn = scenario.ranOn ?? claude;
  const run = {
    id: RUN_ID,
    threadId: THREAD_ID,
    ordinal: 2,
    providerInstanceId: ranOn,
    modelSelection: { ...selection, instanceId: ranOn },
    providerThreadId: null,
    userMessageId: scenario.userMessageId ?? MessageId.make("message:user"),
    rootNodeId: null,
    status: "failed",
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
  };

  const dependencies = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(domainEvents),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) => {
        if (
          command.type === "message.dispatch" &&
          command.modelSelection?.instanceId === scenario.rejectsMoveTo
        ) {
          return Effect.fail(
            new Orchestrator.OrchestratorDispatchError({
              commandId: command.commandId,
              commandType: command.type,
              cause: "The provider is not registered.",
            }),
          );
        }
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
                  messages: (scenario.sentMessageIds ?? [])
                    .filter((id) => filter?.messageIds?.includes(id))
                    .map((id) => ({ id })),
                }
              : {
                  thread: {
                    id: THREAD_ID,
                    projectId: ProjectId.make("project:failover"),
                    providerInstanceId: ranOn,
                    modelSelection: { ...selection, instanceId: ranOn },
                    archivedAt: null,
                    deletedAt: null,
                    settledOverride: null,
                    lineage: { relationshipToParent: null },
                    creationSource: "web",
                  },
                  runs: [
                    ...(scenario.limitedRun === undefined
                      ? []
                      : [
                          {
                            ...run,
                            id: scenario.limitedRun.id,
                            ordinal: 1,
                            providerInstanceId: scenario.limitedRun.ranOn,
                          },
                        ]),
                    run,
                  ],
                  turnItems: [
                    ...(scenario.worked ? [{ id: "item:tool", type: "command_execution" }] : []),
                    {
                      id: "item:error",
                      type: "error",
                      status: "failed",
                      runId: RUN_ID,
                      nodeId: null,
                      ordinal: 1,
                      updatedAt: AT,
                      failure:
                        (scenario.failure ?? "usage_limit") === "usage_limit"
                          ? {
                              class: "usage_limit",
                              message: "Usage limit reached",
                              resetAt: RESET_AT,
                            }
                          : { class: "transport", message: "The session failed to open." },
                    },
                  ].filter((item) => filter?.turnItemTypes?.includes(item.type as never) ?? true),
                },
          ),
        )) as ProjectionStore.ProjectionStoreV2Shape["getThreadRecords"],
    }),
    Layer.mock(AccountBalancer.AccountBalancer)({
      recordLimit: (instanceId, model, resetAt) =>
        Effect.sync(() => {
          limits.push([instanceId, model, resetAt]);
        }),
      rank: (input) =>
        Effect.sync(() => {
          excluded.push(Array.from(input.exclude ?? []));
          return {
            profile: "yu",
            balancing: {
              enabled: true,
              accounts: [],
              includeManager: scenario.includeManager ?? false,
            },
            providers,
            ranked: scenario.ranked,
            skipped: scenario.skipped ?? [],
            now: NOW,
          };
        }),
    }),
    Layer.mock(BrainstormService)({
      managerOf: () => Effect.succeed(scenario.manager === true ? { profile: "yu" } : null),
    }),
  );

  const failRun = Effect.gen(function* () {
    const reactor = yield* AccountFailoverReactor.AccountFailoverReactor;
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
  }).pipe(Effect.provide(AccountFailoverReactor.layer.pipe(Layer.provide(dependencies))));

  return { failRun, dispatched, limits, excluded };
});

/** What a dispatched command did, in the order the thread saw it. */
function summarize(commands: ReadonlyArray<OrchestrationV2ServerCommand>) {
  return commands.map((command) => {
    switch (command.type) {
      case "thread.run-notice.record":
        return ["notice", command.message];
      case "message.dispatch":
        return ["continue", command.modelSelection?.instanceId, command.messageId];
      default:
        return [command.type];
    }
  });
}

describe("AccountFailoverReactor", () => {
  it.effect("moves a thread that hit a usage limit to the next account and continues it", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({ ranked: [toClaude2, toCodex] });
      yield* fixture.failRun;

      assert.deepEqual(fixture.limits, [[claude, selection.model, RESET_AT]]);
      // The move and the turn are one command, so the thread never sits moved and idle.
      assert.deepEqual(summarize(fixture.dispatched), [
        ["continue", claude2, AccountFailoverReactor.failoverMessageId(RUN_ID, claude2)],
        [
          "notice",
          "Moved from Claude to Claude 2: Claude reached its usage limit and resets in 22h 0m.",
        ],
      ]);
      const continuation = fixture.dispatched[0];
      assert.equal(continuation?.type, "message.dispatch");
      if (continuation?.type === "message.dispatch") {
        // The model carries over to another account of the same provider.
        assert.deepEqual(continuation.modelSelection, { ...selection, instanceId: claude2 });
        assert.deepEqual(continuation.dispatchMode, { type: "start_immediately" });
      }
    }),
  );

  it.effect("tries the next account when the first cannot take the thread", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({
        ranked: [toClaude2, toCodex],
        rejectsMoveTo: claude2,
      });
      yield* fixture.failRun;

      assert.deepEqual(summarize(fixture.dispatched), [
        ["continue", codex, AccountFailoverReactor.failoverMessageId(RUN_ID, codex)],
        [
          "notice",
          "Moved from Claude to Codex (gpt-6): Claude reached its usage limit and resets in 22h 0m.",
        ],
      ]);
    }),
  );

  it.effect("moves on when the account it moved to fails before doing anything", () =>
    Effect.gen(function* () {
      const limitedRunId = RunId.make("run:first-limit");
      const sent = AccountFailoverReactor.failoverMessageId(limitedRunId, claude2);
      const fixture = yield* makeHarness({
        ranOn: claude2,
        userMessageId: sent,
        failure: "transport",
        limitedRun: { id: limitedRunId, ranOn: claude },
        ranked: [toCodex],
        sentMessageIds: [sent],
      });
      yield* fixture.failRun;

      assert.isEmpty(fixture.limits);
      // The account that first ran out is not offered the thread back.
      assert.deepEqual(fixture.excluded, [[claude2, claude]]);
      assert.deepEqual(summarize(fixture.dispatched), [
        // Named after the run that first hit the limit, so no account is tried twice.
        ["continue", codex, AccountFailoverReactor.failoverMessageId(limitedRunId, codex)],
        ["notice", "Moved from Claude 2 to Codex (gpt-6): Claude 2 could not start the turn."],
      ]);
    }),
  );

  it.effect("leaves a moved thread alone when its turn got to work before failing", () =>
    Effect.gen(function* () {
      const limitedRunId = RunId.make("run:first-limit");
      const sent = AccountFailoverReactor.failoverMessageId(limitedRunId, claude2);
      const fixture = yield* makeHarness({
        ranOn: claude2,
        userMessageId: sent,
        failure: "transport",
        worked: true,
        limitedRun: { id: limitedRunId, ranOn: claude },
        ranked: [toCodex],
        sentMessageIds: [sent],
      });
      yield* fixture.failRun;
      assert.isEmpty(fixture.dispatched);
    }),
  );

  it.effect("says so once when no account is left", () =>
    Effect.gen(function* () {
      const limitedRunId = RunId.make("run:first-limit");
      const fixture = yield* makeHarness({
        ranOn: codex,
        userMessageId: AccountFailoverReactor.failoverMessageId(limitedRunId, codex),
        ranked: [toClaude2],
        skipped: [
          {
            instanceId: claude,
            label: "Claude",
            reason: "limited",
            limitedUntil: NOW + 3 * 3_600_000,
          },
        ],
        sentMessageIds: [AccountFailoverReactor.failoverMessageId(limitedRunId, claude2)],
      });
      yield* fixture.failRun;

      assert.deepEqual(summarize(fixture.dispatched), [
        [
          "notice",
          "No other account can take this thread: Codex reached its usage limit and resets in 22h 0m, Claude is limited for 3h 0m.",
        ],
      ]);
    }),
  );

  it.effect("leaves a manager thread where it is unless the profile includes it", () =>
    Effect.gen(function* () {
      const pinned = yield* makeHarness({ ranked: [toClaude2], manager: true });
      yield* pinned.failRun;
      assert.isEmpty(pinned.dispatched);
      // The limit still counts for every other thread.
      assert.deepEqual(pinned.limits, [[claude, selection.model, RESET_AT]]);

      const included = yield* makeHarness({
        ranked: [toClaude2],
        manager: true,
        includeManager: true,
      });
      yield* included.failRun;
      assert.deepEqual(summarize(included.dispatched)[0]?.slice(0, 2), ["continue", claude2]);
    }),
  );

  it.effect("ignores a run that failed for another reason", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({ ranked: [toClaude2], failure: "transport" });
      yield* fixture.failRun;
      assert.isEmpty(fixture.dispatched);
    }),
  );
});
