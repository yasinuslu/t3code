import {
  CommandId,
  type ElementManifest,
  isProviderNativeSubagentThread,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { type ElementProblem, elementBlocks, elementProblems } from "@t3tools/shared/elementProps";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { elementComponents } from "../elements/ElementsLibrary.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const COMPONENT_REPAIR_PREFIX = "component-repair:";
const MAX_REMEMBERED_RUNS = 256;
const MAX_SOURCE_LENGTH = 1500;

/**
 * The components the run's replies left broken. A component a later reply in the same run
 * writes again without error counts as fixed.
 */
function brokenComponents(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
  components: ReadonlyMap<string, ElementManifest>,
): ReadonlyArray<ElementProblem> {
  const replies = messages
    .filter((message) => message.role === "assistant" && !message.streaming)
    .toSorted(
      (left, right) =>
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
    );
  const problems: ElementProblem[] = [];
  replies.forEach((reply, index) => {
    const found = elementProblems(reply.text, components);
    if (found.length === 0) return;
    const redrawn = new Set(
      replies.slice(index + 1).flatMap((later) => {
        const broken = new Set(elementProblems(later.text, components).map((p) => p.source));
        return elementBlocks(later.text)
          .filter((block) => !broken.has(block.source))
          .map((block) => block.tag);
      }),
    );
    problems.push(...found.filter((problem) => !redrawn.has(problem.tag)));
  });
  return problems;
}

function quote(source: string): string {
  const text =
    source.length > MAX_SOURCE_LENGTH ? `${source.slice(0, MAX_SOURCE_LENGTH)}\n…` : source;
  return `\`\`\`\`\n${text}\n\`\`\`\``;
}

/** The repair request's text: what broke and how to fix it, with the block as written. */
export function componentRepairText(problems: ReadonlyArray<ElementProblem>): string {
  const count = problems.length === 1 ? "A component" : `${problems.length} components`;
  const tags = [...new Set(problems.map((problem) => problem.tag))].join(", ");
  return [
    `${count} in your last reply could not render; the user sees an error card instead.`,
    ...problems.map(
      (problem) => `<${problem.tag}>: ${problem.errors.join(" ")}\n${quote(problem.source)}`,
    ),
    `Call elements_describe for ${tags}, then send only the corrected component${problems.length === 1 ? "" : "s"} again, with no recap.`,
  ].join("\n\n");
}

/**
 * The message that tells a thread its finished run wrote components that do not render, or null.
 * A run that answered such a message is never asked again, so a component the agent cannot fix
 * costs one extra turn, not a loop.
 */
export function componentRepairCommand(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly runId: RunId;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly components: ReadonlyMap<string, ElementManifest>;
}): OrchestrationV2Command | null {
  const { thread, runId } = input;
  const run = input.runs.find((candidate) => candidate.id === runId);
  if (
    run?.status !== "completed" ||
    run.userMessageId.startsWith(COMPONENT_REPAIR_PREFIX) ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    isProviderNativeSubagentThread(thread)
  )
    return null;
  const problems = brokenComponents(
    input.messages.filter((message) => message.runId === runId),
    input.components,
  );
  if (problems.length === 0) return null;
  const identity = `${COMPONENT_REPAIR_PREFIX}${runId}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: thread.id,
    text: componentRepairText(problems),
    attachments: [],
    // Waits behind a run already going, so it never cuts into the user's next message.
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
 * Checks every finished run's replies against the web-component library with the rules the chat
 * draws by, and sends the agent the components that would show as error cards, so it resends
 * them without the user having to point them out. Works the same for every provider.
 */
export class ComponentRepairReactor extends Context.Service<
  ComponentRepairReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ComponentRepairReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const check = Effect.fn("ComponentRepairReactor.check")(function* ({
    threadId,
    runId,
  }: FinishedRun) {
    const components = elementComponents();
    if (components.size === 0) return;
    const { thread, runs, messages } = yield* projections.getThreadRecords(
      threadId,
      ["runs", "messages"],
      { messageRoles: ["assistant"], messageRunIds: [runId] },
    );
    const command = componentRepairCommand({ thread, runs, runId, messages, components });
    if (command === null) return;
    yield* threads.dispatch(command);
  });

  const worker = yield* makeDrainableWorker((run: FinishedRun) =>
    check(run).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("component check skipped", {
            threadId: run.threadId,
            runId: run.runId,
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  // A finished run can be re-announced (recovery, replays); check it once.
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

  const start: ComponentRepairReactor["Service"]["start"] = Effect.fn(
    "ComponentRepairReactor.start",
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
            Effect.logWarning("component check event stream failed", {
              cause: Cause.pretty(cause),
            }),
        ),
      ),
    );
  });

  return ComponentRepairReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(ComponentRepairReactor, make);
