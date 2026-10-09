import { CommandId, type RunId, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  extractPreviewLinkCandidates,
  previewLinkOrigin,
} from "@t3tools/shared/threadPreviewLinks";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as PreviewLinkStatus from "../preview/PreviewLinkStatus.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** A report rarely names more previews than this; the rest are background links. */
const MAX_REPORT_ORIGINS = 5;
const MAX_REMEMBERED_RUNS = 256;

interface CompletedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

/**
 * Links the previews an agent hands over in its final message. When a run completes, the URLs
 * in that run's last assistant message are checked against the preview status protocol, and
 * each origin that answers with a state is linked to the thread as `source: "report"`. Hosts
 * that do not implement the protocol are ordinary links and stay unlinked, and so do previews
 * the host already removed.
 */
export class PreviewLinkReportReactor extends Context.Service<
  PreviewLinkReportReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/PreviewLinkReportReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const previews = yield* PreviewLinkStatus.PreviewLinkStatus;
  const crypto = yield* Crypto.Crypto;

  const detect = Effect.fn("PreviewLinkReportReactor.detect")(function* ({
    threadId,
    runId,
  }: CompletedRun) {
    const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["assistant"],
      messageRunIds: [runId],
    });
    const report = messages
      .filter((message) => !message.streaming && message.text.trim().length > 0)
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
      )
      .at(-1);
    if (report === undefined) return;
    const candidates = extractPreviewLinkCandidates(report.text, MAX_REPORT_ORIGINS);
    if (candidates.length === 0) return;
    const thread = yield* projections.getThread(threadId);
    const linkedOrigins = new Set(
      (thread.previewLinks ?? []).map((link) => previewLinkOrigin(link.url)),
    );
    yield* Effect.forEach(
      candidates.filter((url) => !linkedOrigins.has(previewLinkOrigin(url))),
      (url) =>
        previews.probe(url).pipe(
          Effect.flatMap((state) =>
            state === "unknown" || state === "gone"
              ? Effect.void
              : crypto.randomUUIDv4.pipe(
                  Effect.flatMap((uuid) =>
                    engine.dispatch({
                      type: "thread.preview-link.link",
                      commandId: CommandId.make(`server:preview-report:${threadId}:${uuid}`),
                      threadId,
                      url,
                      source: "report",
                    }),
                  ),
                ),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );
  });

  const worker = yield* makeDrainableWorker((run: CompletedRun) =>
    detect(run).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("preview link detection skipped", {
            threadId: run.threadId,
            runId: run.runId,
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  // A completed run can be re-announced (recovery, replays); read its report once.
  const seenRuns = new Set<RunId>();
  const enqueueOnce = (run: CompletedRun) =>
    Effect.suspend(() => {
      if (seenRuns.has(run.runId)) return Effect.void;
      seenRuns.add(run.runId);
      if (seenRuns.size > MAX_REMEMBERED_RUNS) {
        seenRuns.delete(seenRuns.values().next().value!);
      }
      return worker.enqueue(run);
    });

  const start: PreviewLinkReportReactor["Service"]["start"] = Effect.fn(
    "PreviewLinkReportReactor.start",
  )(function* () {
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? enqueueOnce({ threadId: event.threadId, runId: event.payload.id })
          : Effect.void,
      ).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("preview link event stream failed", { cause: Cause.pretty(cause) }),
        ),
      ),
    );
  });

  return PreviewLinkReportReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(PreviewLinkReportReactor, make);
