import { type OrchestrationV2AppThread, PresentationPage, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { resolveAttachmentPathById } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import type { ThreadManagementServiceShape } from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  applyPresentationEdit,
  nextPresentation,
  presentationPages,
  startsNewVersion,
} from "../../../orchestration-v2/presentationVersions.ts";
import { newCommandId, readThread, readWritableThread, unavailable } from "../../threadAccess.ts";
import { invalid, storeImageFile, storeThreadFile } from "./storeFile.ts";
import { storePresentationPages } from "./pages.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PresentationToolkit } from "./tools.ts";

const PageList = Schema.Array(PresentationPage);
const encodePages = Schema.encodeSync(Schema.fromJsonString(PageList));
const decodePages = Schema.decodeUnknownEffect(Schema.fromJsonString(PageList));

/** Copies the files an agent's pages point at into T3 storage. */
const storePages = Effect.fn("PresentationHandlers.storePages")(function* (
  threadId: ThreadId,
  input: Parameters<typeof storePresentationPages>[0],
) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* storePresentationPages(input, {
    image: (path) => storeImageFile(threadId, path),
    html: Effect.fn("PresentationHandlers.html")(function* (source) {
      const html =
        "html" in source
          ? source.html
          : yield* fileSystem
              .readFileString(source.path)
              .pipe(Effect.mapError(() => invalid(`Could not read ${source.path}.`)));
      const bytes = new TextEncoder().encode(html);
      return yield* storeThreadFile({ threadId, bytes, extension: ".html", generic: true });
    }),
  });
});

/**
 * Writes the thread's next pages as one version step: within the thread's latest run they amend
 * the current version; otherwise the current pages are stored as that version's snapshot first.
 */
export const writePresentationPages = Effect.fn("mcp.presentation.write")(function* (
  context: {
    readonly threads: ThreadManagementServiceShape;
    readonly projection: { readonly thread: OrchestrationV2AppThread };
  },
  pages: ReadonlyArray<PresentationPage>,
) {
  const thread = context.projection.thread;
  const shell = yield* context.threads
    .getThreadShell(thread.id)
    .pipe(Effect.orElseSucceed(() => null));
  const run = shell?.latestRunId ?? undefined;
  const previous = thread.presentation;
  const snapshot =
    previous !== undefined && startsNewVersion(previous, run)
      ? yield* storeThreadFile({
          threadId: thread.id,
          bytes: new TextEncoder().encode(encodePages(previous.pages)),
          extension: ".json",
          generic: true,
        })
      : undefined;
  const engine = yield* Orchestrator.OrchestratorV2;
  yield* engine
    .dispatch({
      type: "thread.presentation.set",
      commandId: yield* newCommandId(),
      threadId: thread.id,
      pages,
      ...(run === undefined ? {} : { run }),
      ...(snapshot === undefined ? {} : { snapshot }),
    })
    .pipe(Effect.mapError(unavailable));
  // What the orchestrator just applied, for the agent's answer: ids and the version.
  const written = nextPresentation(
    previous,
    { pages, run, snapshot },
    DateTime.formatIso(yield* DateTime.now),
  );
  return {
    threadId: thread.id,
    version: written?.versions?.at(-1)?.version ?? 0,
    pages: (written?.pages ?? []).map((page) => ({
      id: page.id ?? "",
      ...(page.title === undefined ? {} : { title: page.title }),
    })),
  };
});

export const layer = McpToolAccess.toLayer(PresentationToolkit, {
  presentation_set: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const context = yield* readWritableThread(input.threadId);
      const pages = yield* storePages(context.projection.thread.id, input.pages);
      return yield* writePresentationPages(context, pages);
    }),
  ),
  presentation_edit: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const context = yield* readWritableThread(input.threadId);
      const put = yield* storePages(context.projection.thread.id, input.put ?? []);
      const pages = applyPresentationEdit(
        presentationPages(context.projection.thread.presentation),
        {
          put,
          ...(input.remove === undefined ? {} : { remove: input.remove }),
          ...(input.order === undefined ? {} : { order: input.order }),
        },
      );
      if (typeof pages === "string") return yield* invalid(pages);
      if (pages.length === 0) {
        return yield* invalid("That leaves no pages; presentation_set with none removes it.");
      }
      return yield* writePresentationPages(context, pages);
    }),
  ),
  presentation_get: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const threadId = projection.thread.id;
      const presentation = projection.thread.presentation;
      const versions = presentation?.versions ?? [];
      const current = versions.at(-1)?.version ?? (presentation ? 1 : undefined);
      if (input.version === undefined || input.version === current) {
        return {
          threadId,
          ...(current === undefined ? {} : { version: current }),
          pages: presentation?.pages ?? [],
          versions,
        };
      }
      const snapshot = versions.find((entry) => entry.version === input.version)?.snapshot;
      if (snapshot === undefined) {
        return yield* invalid(`Version ${input.version} is not kept.`);
      }
      const config = yield* ServerConfig.ServerConfig;
      const path = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: snapshot,
      });
      const fileSystem = yield* FileSystem.FileSystem;
      const pages = yield* (
        path === null ? Effect.fail(null) : fileSystem.readFileString(path)
      ).pipe(
        Effect.flatMap(decodePages),
        Effect.mapError(() => invalid(`Version ${input.version} could not be read.`)),
      );
      return { threadId, version: input.version, pages, versions };
    }),
  ),
});
