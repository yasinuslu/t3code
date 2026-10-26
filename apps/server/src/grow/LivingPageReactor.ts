/**
 * LivingPageReactor - keeps each thread's living page current, apart from the thread's agent.
 *
 * After every finished run, a cheap writer model reads what happened and the page as it stands,
 * and composes the page's next version from the workspace's widget pool (GrowWidgetPool). The
 * page is the thread's presentation page `living`, so it is versioned per run with the rest.
 * When the writer names a widget the pool lacks, the widget smith (the user's stronger text
 * model) writes it into the pool once, and the page is composed again with it.
 *
 * @module LivingPageReactor
 */
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type PresentationPage,
  type PresentationWidgetBlock,
  type RunId,
  THREAD_PRESENTATION_MAX_BLOCKS,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { BrainstormService } from "../brainstorm/BrainstormService.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import { writePresentationPages } from "../mcp/toolkits/presentation/handlers.ts";
import { localImagePaths } from "../mcp/toolkits/threadStatus/reportImages.ts";
import { storeImageFile } from "../mcp/toolkits/threadStatus/storeFile.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GrowWidgetPool from "./GrowWidgetPool.ts";

const decodeProps = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** The presentation page the writer keeps. */
export const LIVING_PAGE_ID = "living";
const MAX_REMEMBERED = 256;
const OWNER_MESSAGES = 6;
const DIFF_CHARS = 16_000;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}\n[...]`;

/** The thread's widget page, if it has one. */
export function livingPage(
  thread: Pick<OrchestrationV2AppThread, "presentation">,
): Extract<PresentationPage, { kind: "widgets" }> | undefined {
  const page = thread.presentation?.pages.find((candidate) => candidate.id === LIVING_PAGE_ID);
  return page?.kind === "widgets" ? page : undefined;
}

/**
 * What the writer reads about the work: the owner's recent words, the agent's latest answer and
 * status report, its own pages, links, the thread's code changes so far, and every image it may
 * show by `attachment:<id>`.
 */
export function formatLivingPageContext(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly projectTitle: string;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  /** Images the agent's answer pointed at by path, now stored, by path. */
  readonly storedPaths: ReadonlyMap<string, string>;
  /** The thread's whole diff from its first checkpoint, when it changed files. */
  readonly diff?: string | undefined;
}): string {
  const { thread } = input;
  const done = input.messages.filter((message) => !message.streaming);
  const owner = done.filter((message) => message.role === "user").slice(-OWNER_MESSAGES);
  const answer = done.findLast((message) => message.role === "assistant");
  const images: string[] = [];
  const lines: string[] = [`Thread: ${thread.title}`, `Project: ${input.projectTitle}`];
  for (const pr of thread.pullRequests ?? []) {
    lines.push(`Pull request: #${pr.number} ${pr.url}`);
  }
  for (const link of thread.previewLinks ?? []) {
    lines.push(`Preview: ${link.label ? `${link.label} ` : ""}${link.url}`);
  }
  lines.push("", "## The owner's messages, oldest first");
  for (const message of owner) {
    lines.push(`- ${clip(message.text.trim(), 1_500)}`);
    for (const attachment of message.attachments) {
      if (attachment.type === "image") {
        images.push(`attachment:${attachment.id}: an image the owner sent (${attachment.name})`);
      }
    }
  }
  if (answer !== undefined) {
    let text = answer.text;
    for (const [path, id] of input.storedPaths) {
      text = text.split(path).join(`attachment:${id}`);
      images.push(`attachment:${id}: from the agent's answer (${path.split("/").at(-1)})`);
    }
    lines.push("", "## The agent's latest answer", clip(text.trim(), 6_000));
  }
  if (thread.statusReport !== undefined) {
    lines.push("", "## The agent's status report", clip(thread.statusReport.text.trim(), 4_000));
    for (const match of thread.statusReport.text.matchAll(
      /!\[([^\]]*)\]\(<?attachment:([\w-]+)>?\)/g,
    )) {
      images.push(`attachment:${match[2]}: from the status report (${match[1] || "image"})`);
    }
  }
  const pages = (thread.presentation?.pages ?? []).filter((page) => page.id !== LIVING_PAGE_ID);
  if (pages.length > 0) {
    lines.push("", "## Pages the agent made");
    for (const page of pages) {
      const title = page.title ?? page.id ?? page.kind;
      switch (page.kind) {
        case "image":
          lines.push(`- image "${title}": attachment:${page.image}`);
          images.push(
            `attachment:${page.image}: the agent's page "${title}"${
              page.marks?.length ? `, boxes: ${encodeJson(page.marks)}` : ""
            }`,
          );
          break;
        case "doc":
          lines.push(`- doc "${title}":`, clip(page.markdown, 2_000));
          break;
        case "form":
          lines.push(
            `- questions "${title}": ${page.fields.map((field) => field.label).join("; ")}`,
          );
          break;
        case "html":
          lines.push(`- interactive page "${title}"`);
          break;
        case "widgets":
          break;
      }
    }
  }
  if (input.diff !== undefined && input.diff.trim().length > 0) {
    lines.push(
      "",
      "## The code changes so far (unified diff)",
      clip(input.diff.trim(), DIFF_CHARS),
    );
  }
  if (images.length > 0)
    lines.push("", "## Images you can show", ...images.map((line) => `- ${line}`));
  return lines.join("\n");
}

/** The writer's blocks as stored blocks: known widgets with props that parse, nothing else. */
export function acceptBlocks(
  blocks: TextGeneration.LivingPageGenerationResult["blocks"],
  known: ReadonlySet<string>,
): ReadonlyArray<PresentationWidgetBlock> {
  const accepted: PresentationWidgetBlock[] = [];
  for (const block of blocks) {
    if (!known.has(block.widget)) continue;
    const props = decodeProps(block.propsJson);
    if (Option.isNone(props)) continue;
    accepted.push({
      widget: block.widget,
      props: props.value,
      ...(block.span === "half" ? { span: "half" as const } : {}),
    });
    if (accepted.length === THREAD_PRESENTATION_MAX_BLOCKS) break;
  }
  return accepted;
}

interface SmithInput {
  readonly name: string;
  readonly purpose: string;
  readonly job: Job;
  readonly model: ModelSelection;
}

interface Job {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export class LivingPageReactor extends Context.Service<
  LivingPageReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/grow/LivingPageReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const brainstorm = yield* BrainstormService;
  const pool = yield* GrowWidgetPool.GrowWidgetPool;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const diffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;

  /** The user's text model for the smith; its provider's small model for the writer. */
  const models = (projectId: OrchestrationV2AppThread["projectId"]) =>
    Effect.gen(function* () {
      const strong: ModelSelection = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projectId,
      ).settings.textGenerationModelSelection;
      const instance = yield* registry.getInstance(strong.instanceId);
      const small = instance
        ? DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[instance.driverKind]
        : undefined;
      const cheap: ModelSelection =
        small === undefined ? strong : { instanceId: strong.instanceId, model: small };
      return { cheap, strong };
    });

  // Every widget asked for, once per server run: the smith may name what it writes differently,
  // and a page that keeps asking for the same thing must not keep the smith busy.
  const asked = new Set<string>();
  // The two workers feed each other: a page asks for a widget, a new widget recomposes the page.
  const queue: {
    compose: (job: Job) => Effect.Effect<void>;
    smith: (input: SmithInput) => Effect.Effect<void>;
  } = { compose: () => Effect.void, smith: () => Effect.void };

  const compose = Effect.fn("LivingPageReactor.compose")(function* ({ threadId, runId }: Job) {
    // Living pages belong to the experimental Grow presentation (Settings > Experimental).
    if (!(yield* serverSettings.getSettings).growPresentation) return;
    const snapshot = yield* pool.read;
    if (snapshot.widgets.length === 0) return;
    const { thread, runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    const latest = runs.findLast((run) => run.status !== "queued");
    if (
      latest?.id !== runId ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.lineage.relationshipToParent === "subagent"
    ) {
      return;
    }
    if ((yield* brainstorm.managerOf(threadId)) !== null) return;
    const project = yield* projects.get(thread.projectId);
    if (Option.isNone(project)) return;
    const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["user", "assistant"],
    });
    const answer = messages.findLast(
      (message) => message.role === "assistant" && !message.streaming,
    );
    const storedPaths = new Map<string, string>();
    for (const path of localImagePaths(answer?.text ?? "").slice(0, 8)) {
      const id = yield* storeImageFile(threadId, path).pipe(Effect.option);
      if (Option.isSome(id)) storedPaths.set(path, id.value);
    }
    // A thread with no checkpoint (no repository, nothing captured yet) simply shows no code.
    const diff = yield* diffs
      .getFullThreadDiff({ threadId, toTurnCount: latest.ordinal })
      .pipe(Effect.option);
    const current = livingPage(thread);
    const { cheap, strong } = yield* models(thread.projectId);
    const result = yield* textGeneration.generateLivingPage({
      cwd: thread.worktreePath ?? project.value.workspaceRoot,
      context: formatLivingPageContext({
        thread,
        projectTitle: project.value.title,
        messages,
        storedPaths,
        diff: Option.isSome(diff) ? diff.value.diff : undefined,
      }),
      pool: GrowWidgetPool.poolCatalog(snapshot),
      ...(current === undefined ? {} : { previous: encodeJson(current.blocks) }),
      modelSelection: cheap,
    });
    const known = new Set(snapshot.widgets.map((widget) => widget.name));
    const blocks = result.unchanged ? [] : acceptBlocks(result.blocks, known);
    if (blocks.length > 0) {
      const others = (thread.presentation?.pages ?? []).filter(
        (page) => page.id !== LIVING_PAGE_ID,
      );
      yield* writePresentationPages({ threads, projection: { thread } }, [
        { kind: "widgets", id: LIVING_PAGE_ID, title: "Living page", blocks },
        ...others,
      ]);
    }
    for (const wanted of result.missing.slice(0, 1)) {
      const name = wanted.name.trim();
      if (known.has(name) || asked.has(name)) continue;
      asked.add(name);
      yield* queue.smith({
        name,
        purpose: wanted.purpose,
        job: { threadId, runId },
        model: strong,
      });
    }
  });

  const smith = Effect.fn("LivingPageReactor.smith")(function* (input: SmithInput) {
    const snapshot = yield* pool.read;
    const sample =
      snapshot.widgets.find((widget) => widget.name === "Metrics") ?? snapshot.widgets[0];
    const sampleSource = sample === undefined ? "" : yield* pool.source(sample.name);
    const written = yield* textGeneration.generateWidget({
      cwd: snapshot.dir,
      name: input.name,
      purpose: input.purpose,
      readme: snapshot.readme,
      sample: sampleSource,
      existing: snapshot.widgets.map((widget) => widget.name),
      modelSelection: input.model,
    });
    yield* pool.write(written.name.trim(), written.code);
    yield* Effect.logInfo("widget smith added a widget", { name: written.name });
    // The page that asked for it gets it now.
    yield* queue.compose(input.job);
  });

  const logged =
    (what: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.asVoid,
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => Effect.logWarning(`${what} failed`, { cause: Cause.pretty(cause) }),
        ),
      );

  const composeWorker = yield* makeDrainableWorker((job: Job) =>
    logged("living page")(compose(job)),
  );
  const smithWorker = yield* makeDrainableWorker((input: SmithInput) =>
    logged("widget smith")(smith(input)),
  );

  queue.compose = composeWorker.enqueue;
  queue.smith = smithWorker.enqueue;

  // A finished run can be re-announced (recovery, replays); compose for it once.
  const seen = new Set<RunId>();
  const enqueueOnce = (job: Job) =>
    Effect.suspend(() => {
      if (seen.has(job.runId)) return Effect.void;
      seen.add(job.runId);
      if (seen.size > MAX_REMEMBERED) seen.delete(seen.values().next().value!);
      return composeWorker.enqueue(job);
    });

  const start: LivingPageReactor["Service"]["start"] = Effect.fn("LivingPageReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "run.updated" && event.payload.status === "completed"
            ? enqueueOnce({ threadId: event.threadId, runId: event.payload.id })
            : Effect.void,
        ).pipe(logged("living page event stream")),
      );
    },
  );

  return LivingPageReactor.of({
    start,
    drain: Effect.all([composeWorker.drain, smithWorker.drain]).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(LivingPageReactor, make);
