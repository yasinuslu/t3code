import {
  CommandId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type RunId,
  type ThreadId,
  threadStatusReportHasProof,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { latestExecutedRun } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { BrainstormService } from "../brainstorm/BrainstormService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const PROOF_REQUEST_PREFIX = "proof-request:";
const MAX_REMEMBERED_RUNS = 256;

export const PROOF_REQUEST_TEXT =
  "Your work has nothing to see yet. Before you stop, call presentation_set with what I understand at a glance: a screenshot of the result with marks on what changed (a short GIF if it moves), a short page, or for work with nothing on screen, an image of the evidence. Change nothing else.";

/**
 * The message that asks a thread for proof after `runId` finished without
 * one. Only threads that report work are asked (a status report, a pull
 * request or a preview), and never after a run that answered an earlier ask,
 * so a thread that cannot produce an image is asked once, not forever.
 */
export function proofRequestCommand(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly runId: RunId;
}): OrchestrationV2Command | null {
  const { thread, runs, runId } = input;
  const run = latestExecutedRun(runs);
  if (
    run?.id !== runId ||
    run.status !== "completed" ||
    run.userMessageId.startsWith(PROOF_REQUEST_PREFIX) ||
    // Someone already sent the next message; that run reports instead.
    runs.some((other) => other.status === "queued") ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride === "settled" ||
    // Subagents and delegated tasks report to their parent, which carries the proof.
    thread.lineage.relationshipToParent === "subagent"
  )
    return null;
  const reportsWork =
    thread.statusReport !== undefined ||
    (thread.pullRequests?.length ?? 0) > 0 ||
    (thread.previewLinks?.length ?? 0) > 0 ||
    thread.linkedPullRequest != null ||
    thread.branchPullRequest != null;
  if (!reportsWork) return null;
  if (thread.presentation !== undefined) return null;
  if (thread.statusReport !== undefined && threadStatusReportHasProof(thread.statusReport.text)) {
    return null;
  }
  const identity = `${PROOF_REQUEST_PREFIX}${runId}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: thread.id,
    text: PROOF_REQUEST_TEXT,
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "agent",
    creationSource: "server",
  };
}

interface FinishedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

/**
 * Asks every thread that finished work without a proof image for one, so the
 * user never has to. Manager threads are skipped: they hand work out rather
 * than make it.
 */
export class ProofRequestReactor extends Context.Service<
  ProofRequestReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ProofRequestReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const brainstorm = yield* BrainstormService;

  const askForProof = Effect.fn("ProofRequestReactor.askForProof")(function* ({
    threadId,
    runId,
  }: FinishedRun) {
    const { thread, runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    const command = proofRequestCommand({ thread, runs, runId });
    if (command === null) return;
    if ((yield* brainstorm.managerOf(threadId)) !== null) return;
    yield* threads.dispatch(command);
  });

  const worker = yield* makeDrainableWorker((run: FinishedRun) =>
    askForProof(run).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("proof request skipped", {
            threadId: run.threadId,
            runId: run.runId,
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  // A finished run can be re-announced (recovery, replays); act on it once.
  const seenRuns = new Set<RunId>();
  const enqueueOnce = (run: FinishedRun) =>
    Effect.suspend(() => {
      if (seenRuns.has(run.runId)) return Effect.void;
      seenRuns.add(run.runId);
      if (seenRuns.size > MAX_REMEMBERED_RUNS) {
        seenRuns.delete(seenRuns.values().next().value!);
      }
      return worker.enqueue(run);
    });

  const start: ProofRequestReactor["Service"]["start"] = Effect.fn("ProofRequestReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "run.updated" && event.payload.status === "completed"
            ? enqueueOnce({ threadId: event.threadId, runId: event.payload.id })
            : Effect.void,
        ).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("proof request event stream failed", {
                cause: Cause.pretty(cause),
              }),
          ),
        ),
      );
    },
  );

  return ProofRequestReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(ProofRequestReactor, make);
