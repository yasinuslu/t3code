import {
  CommandId,
  isProviderNativeSubagentThread,
  MessageId,
  RunId,
  type ThreadId,
} from "@t3tools/contracts";
import type { SkippedAccount } from "@t3tools/shared/accountBalancing";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { modelSelectionCommandType } from "@t3tools/shared/model";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import { formatDuration } from "@t3tools/shared/usageLimits";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { BrainstormService } from "../brainstorm/BrainstormService.ts";
import * as AccountBalancer from "../provider/AccountBalancer.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const CONTINUE_PROMPT = "Continue where you left off.";
const FAILOVER_MESSAGE_PREFIX = "message:account-failover:";
const MAX_REMEMBERED_RUNS = 256;

interface FailedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

/**
 * The message that continues a thread on `instanceId`. Its id names the run
 * that first hit the limit, so every account is tried once per limit however
 * many hops the thread takes.
 */
export function failoverMessageId(limitedRunId: RunId, instanceId: string): MessageId {
  return MessageId.make(`${FAILOVER_MESSAGE_PREFIX}${limitedRunId}:${instanceId}`);
}

/** The run that first hit the limit, when `messageId` is a failover continuation. */
export function failoverLimitedRunId(messageId: MessageId): RunId | null {
  if (!messageId.startsWith(FAILOVER_MESSAGE_PREFIX)) return null;
  // Instance ids are slugs, so the last colon ends the run id.
  const rest = messageId.slice(FAILOVER_MESSAGE_PREFIX.length);
  const end = rest.lastIndexOf(":");
  return end <= 0 ? null : RunId.make(rest.slice(0, end));
}

function describeSkipped(account: SkippedAccount, now: number): string {
  switch (account.reason) {
    case "limited":
      return `${account.label} is limited for ${formatDuration((account.limitedUntil ?? now) - now)}`;
    case "disabled":
      return `${account.label} is turned off`;
    case "signed-out":
      return `${account.label} is signed out`;
    case "manual-only":
      return `${account.label} is manual only`;
    case "missing":
    case "unavailable":
    case "no-model":
      return `${account.label} is unavailable`;
  }
}

/** States a wait, not a wall-clock time: clients read it in their own timezone. */
function limitReason(account: string, resetAt: string | null | undefined, now: number): string {
  const until = resetAt == null ? Number.NaN : Date.parse(resetAt);
  return Number.isFinite(until) && until > now
    ? `${account} reached its usage limit and resets in ${formatDuration(until - now)}`
    : `${account} reached its usage limit`;
}

/**
 * Moves a thread that stopped on a usage limit to the next account its code
 * profile balances across, and continues it there with a provider handoff.
 * When that account cannot take the thread either (its own limit, or the turn
 * fails before answering) the next one is tried; once none is left the thread
 * gets one notice and stays where it is. Profiles opt in through
 * `accountBalancing`, and a profile's manager thread only moves when the
 * profile says so.
 */
export class AccountFailoverReactor extends Context.Service<
  AccountFailoverReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/AccountFailoverReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const balancer = yield* AccountBalancer.AccountBalancer;
  const brainstorm = yield* BrainstormService;

  const failOver = Effect.fn("AccountFailoverReactor.failOver")(function* ({
    threadId,
    runId,
  }: FailedRun) {
    const { thread, runs, turnItems } = yield* projections.getThreadRecords(
      threadId,
      ["runs", "turnItems"],
      { turnItemRunIds: [runId], turnItemTypes: ["error", "assistant_message"] },
    );
    const run = latestExecutedRun(runs);
    if (run?.id !== runId || run.status !== "failed") return;
    const failure = latestRootProviderFailure(run, turnItems);
    const limited = failure?.class === "usage_limit";
    if (limited) yield* balancer.recordLimit(run.providerInstanceId, failure.resetAt);
    const earlierLimitedRunId = failoverLimitedRunId(run.userMessageId);
    // A continuation that fails before answering means the account could not
    // take the thread at all; one that got to work failed for its own reasons.
    const neverAnswered =
      earlierLimitedRunId !== null && !turnItems.some((item) => item.type === "assistant_message");
    if (
      (!limited && !neverAnswered) ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.settledOverride === "settled" ||
      // The provider owns a native subagent's conversation; its parent is the thread to move.
      isProviderNativeSubagentThread(thread) ||
      // Someone already moved the thread off the account that failed.
      thread.providerInstanceId !== run.providerInstanceId
    )
      return;
    const ranking = yield* balancer.rank({
      projectId: thread.projectId,
      selection: thread.modelSelection,
      exclude: new Set([run.providerInstanceId]),
    });
    if (ranking === null) return;
    if (!ranking.balancing.includeManager && (yield* brainstorm.managerOf(threadId)) !== null) {
      return;
    }

    const limitedRunId = earlierLimitedRunId ?? run.id;
    const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageIds: ranking.ranked.map((account) =>
        failoverMessageId(limitedRunId, account.instance.instanceId),
      ),
    });
    const tried = new Set(messages.map((message) => message.id));
    const from =
      ranking.providers.find((provider) => provider.instanceId === run.providerInstanceId)
        ?.displayName ?? run.providerInstanceId;
    const reason = limited
      ? limitReason(from, failure.resetAt, ranking.now)
      : `${from} could not start the turn`;
    const notice = (signal: string, message: string) =>
      threads.dispatch({
        type: "thread.run-notice.record",
        commandId: CommandId.make(`server:account-failover:${signal}:${run.id}`),
        threadId,
        runId: run.id,
        signal,
        message,
      });

    const rejected: Array<string> = [];
    for (const account of ranking.ranked) {
      const instanceId = account.instance.instanceId;
      const messageId = failoverMessageId(limitedRunId, instanceId);
      if (tried.has(messageId)) continue;
      const to = account.instance.displayName ?? instanceId;
      const switched = yield* threads
        .dispatch({
          type: modelSelectionCommandType(thread.providerInstanceId, account.selection),
          commandId: CommandId.make(`server:account-failover:switch:${run.id}:${instanceId}`),
          threadId,
          modelSelection: account.selection,
        })
        .pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("account failover could not switch", {
              threadId,
              instanceId,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (!switched) {
        rejected.push(`${to} could not take this thread`);
        continue;
      }
      yield* notice(
        "account-failover",
        `Moved from ${from} to ${to}${
          account.sameDriver ? "" : ` (${account.selection.model})`
        }: ${reason}.`,
      );
      yield* threads.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:account-failover:continue:${run.id}:${instanceId}`),
        threadId,
        messageId,
        text: CONTINUE_PROMPT,
        attachments: [],
        modelSelection: account.selection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      return;
    }

    const unusable = [
      ...ranking.skipped.map((account) => describeSkipped(account, ranking.now)),
      ...rejected,
    ];
    yield* notice(
      "account-failover-exhausted",
      `No other account can take this thread: ${reason}${
        unusable.length === 0 ? "" : `, ${unusable.join(", ")}`
      }.`,
    );
  });

  const worker = yield* makeDrainableWorker((run: FailedRun) =>
    failOver(run).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("account failover skipped", {
            threadId: run.threadId,
            runId: run.runId,
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  // A failed run can be re-announced (recovery, replays); act on it once.
  const seenRuns = new Set<RunId>();
  const enqueueOnce = (run: FailedRun) =>
    Effect.suspend(() => {
      if (seenRuns.has(run.runId)) return Effect.void;
      seenRuns.add(run.runId);
      if (seenRuns.size > MAX_REMEMBERED_RUNS) {
        seenRuns.delete(seenRuns.values().next().value!);
      }
      return worker.enqueue(run);
    });

  const start: AccountFailoverReactor["Service"]["start"] = Effect.fn(
    "AccountFailoverReactor.start",
  )(function* () {
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (event.type !== "run.updated") return Effect.void;
        if (event.payload.status === "failed") {
          return enqueueOnce({ threadId: event.threadId, runId: event.payload.id });
        }
        return event.payload.status === "completed" && event.payload.startedAt !== null
          ? balancer.clearLimit(
              event.payload.providerInstanceId,
              DateTime.toEpochMillis(event.payload.startedAt),
            )
          : Effect.void;
      }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("account failover event stream failed", {
              cause: Cause.pretty(cause),
            }),
        ),
      ),
    );
  });

  return AccountFailoverReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(AccountFailoverReactor, make);
