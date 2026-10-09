import {
  EventId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ThreadPreviewLink,
  type ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as PreviewLinkStatus from "../preview/PreviewLinkStatus.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as PreviewLinkReportReactor from "./PreviewLinkReportReactor.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const THREAD_ID = ThreadId.make("preview-report-thread");
const RUN_ID = RunId.make("preview-report-run");
const AT = DateTime.makeUnsafe("2026-10-10T12:00:00.000Z");

type LinkCommand = Extract<OrchestrationV2Command, { readonly type: "thread.preview-link.link" }>;

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

function assistantMessage(text: string, streaming = false): OrchestrationV2ConversationMessage {
  return {
    createdBy: "agent",
    creationSource: "provider",
    id: MessageId.make(`message:${text.length}:${streaming}`),
    threadId: THREAD_ID,
    runId: RUN_ID,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming,
    createdAt: AT,
    updatedAt: AT,
  };
}

function runUpdated(status: OrchestrationV2Run["status"]): OrchestrationV2DomainEvent {
  return {
    type: "run.updated",
    id: EventId.make(`event:${status}`),
    threadId: THREAD_ID,
    runId: RUN_ID,
    occurredAt: AT,
    payload: {
      id: RUN_ID,
      threadId: THREAD_ID,
      ordinal: 1,
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      providerThreadId: null,
      userMessageId: MessageId.make("message:user"),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: AT,
      startedAt: AT,
      completedAt: AT,
      checkpointId: null,
      contextHandoffId: null,
    },
  } as OrchestrationV2DomainEvent;
}

const makeHarness = Effect.fn("makePreviewLinkReportHarness")(function* (options: {
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly linked?: ReadonlyArray<ThreadPreviewLink>;
  readonly states: Readonly<Record<string, ThreadPreviewLinkState>>;
}) {
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const reportRead = yield* Deferred.make<void>();
  const linked: Array<LinkCommand> = [];
  const probed: Array<string> = [];

  const dependencies = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) => {
        if (command.type !== "thread.preview-link.link") {
          return Effect.die(new Error(`Unexpected command: ${command.type}`));
        }
        linked.push(command);
        return Effect.succeed({ sequence: 1, storedEvents: [] });
      },
      streamDomainEvents: Stream.fromQueue(domainEvents),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadRecords: ((_threadId, _fields, filter) =>
        Deferred.succeed(reportRead, undefined).pipe(
          Effect.as({
            messages: options.messages.filter((message) =>
              filter?.messageRunIds?.includes(message.runId!),
            ),
          }),
        )) as ProjectionStore.ProjectionStoreV2Shape["getThreadRecords"],
      getThread: () =>
        Effect.succeed({
          previewLinks: options.linked ?? [],
        } as unknown as Effect.Success<
          ReturnType<ProjectionStore.ProjectionStoreV2Shape["getThread"]>
        >),
    }),
    Layer.mock(PreviewLinkStatus.PreviewLinkStatus)({
      probe: (url) => {
        probed.push(url);
        return Effect.succeed(options.states[new URL(url).origin] ?? "unknown");
      },
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );

  return {
    domainEvents,
    reportRead,
    linked,
    probed,
    layer: PreviewLinkReportReactor.layer.pipe(Layer.provide(dependencies)),
  };
});

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const completeRun = Effect.fn("completePreviewReportRun")(function* (fixture: Harness) {
  const reactor = yield* PreviewLinkReportReactor.PreviewLinkReportReactor;
  yield* reactor.start();
  yield* Queue.offer(fixture.domainEvents, runUpdated("completed"));
  yield* Deferred.await(fixture.reportRead);
  yield* reactor.drain;
});

describe("PreviewLinkReportReactor", () => {
  it.effect("links previews from the final report that answer the status protocol", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({
        messages: [
          assistantMessage("Starting http://old.pv.example.org"),
          assistantMessage(
            [
              "Preview: https://t3code-branch.pv.example.org/settings.",
              "Docs at https://docs.example.org/guide and (http://localhost:5173/).",
              "Again https://t3code-branch.pv.example.org/other",
              "Already linked https://linked.pv.example.org",
            ].join("\n"),
          ),
          assistantMessage("still typing https://draft.pv.example.org", true),
        ],
        linked: [
          {
            url: "https://linked.pv.example.org",
            source: "agent",
            linkedAt: "2026-10-10T11:00:00.000Z",
          },
        ],
        states: {
          "https://t3code-branch.pv.example.org": "stopped",
          "https://linked.pv.example.org": "running",
          "http://localhost:5173": "running",
        },
      });
      yield* completeRun(fixture).pipe(Effect.provide(fixture.layer));

      // The last finished message is the report; its earlier and streaming siblings are not.
      assert.deepEqual(fixture.probed, [
        "https://t3code-branch.pv.example.org/settings",
        "https://docs.example.org/guide",
        "http://localhost:5173",
      ]);
      assert.deepEqual(
        fixture.linked.map(({ url, source, threadId }) => ({ url, source, threadId })),
        [
          {
            url: "https://t3code-branch.pv.example.org/settings",
            source: "report",
            threadId: THREAD_ID,
          },
          { url: "http://localhost:5173", source: "report", threadId: THREAD_ID },
        ],
      );
    }),
  );

  it.effect("links nothing when no URL in the report answers", () =>
    Effect.gen(function* () {
      const fixture = yield* makeHarness({
        messages: [assistantMessage("See https://github.com/owner/repo/pull/1")],
        states: {},
      });
      yield* completeRun(fixture).pipe(Effect.provide(fixture.layer));
      assert.deepEqual(fixture.probed, ["https://github.com/owner/repo/pull/1"]);
      assert.deepEqual(fixture.linked, []);
    }),
  );
});
