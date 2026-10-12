/**
 * ThreadStatusReports - the status card an agent pins to its thread.
 *
 * A report is short markdown that replaces the last one. Screenshots it
 * embeds by absolute path are copied into the attachment store first, so the
 * card keeps showing them after the worktree or /tmp is cleaned up.
 *
 * @module ThreadStatusReports
 */
import { CommandId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createDeterministicAttachmentId, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "./Orchestrator.ts";
import {
  linkStoredImages,
  localImagePaths,
  threadStatusReportAttachmentIds,
} from "./threadStatusReportImages.ts";

const MAX_IMAGES = 12;
const MIB = 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * MIB;

export class ThreadStatusReportLocalImagesRefusedError extends Schema.TaggedError<ThreadStatusReportLocalImagesRefusedError>()(
  "ThreadStatusReportLocalImagesRefusedError",
  {},
) {
  override get message(): string {
    return "Only an agent running in a T3 thread can attach screenshots by local path.";
  }
}

export class ThreadStatusReportTooManyImagesError extends Schema.TaggedError<ThreadStatusReportTooManyImagesError>()(
  "ThreadStatusReportTooManyImagesError",
  { count: Schema.Number },
) {
  override get message(): string {
    return `The report embeds ${this.count} screenshots; a status report can carry at most ${MAX_IMAGES}.`;
  }
}

export class ThreadStatusReportImageUnreadableError extends Schema.TaggedError<ThreadStatusReportImageUnreadableError>()(
  "ThreadStatusReportImageUnreadableError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read screenshot ${this.path}. Use an absolute path to an existing image file.`;
  }
}

export class ThreadStatusReportImageTooLargeError extends Schema.TaggedError<ThreadStatusReportImageTooLargeError>()(
  "ThreadStatusReportImageTooLargeError",
  { path: Schema.String, sizeBytes: Schema.Number },
) {
  override get message(): string {
    return `Screenshot ${this.path} is larger than ${MAX_IMAGE_BYTES / MIB} MiB.`;
  }
}

export class ThreadStatusReportStoreError extends Schema.TaggedError<ThreadStatusReportStoreError>()(
  "ThreadStatusReportStoreError",
  { threadId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "The status report's screenshots could not be stored.";
  }
}

export class ThreadStatusReports extends Context.Service<
  ThreadStatusReports,
  {
    /**
     * Sets the thread's status report, replacing the last. Local screenshots
     * are stored as the thread's attachments first; `readLocalImages` is false
     * for callers that may not read files on this host.
     */
    readonly set: (input: {
      readonly threadId: ThreadId;
      readonly report: string;
      readonly readLocalImages: boolean;
    }) => Effect.Effect<
      { readonly storedImages: number },
      | ThreadStatusReportLocalImagesRefusedError
      | ThreadStatusReportTooManyImagesError
      | ThreadStatusReportImageUnreadableError
      | ThreadStatusReportImageTooLargeError
      | ThreadStatusReportStoreError
      | Orchestrator.OrchestratorV2Error
    >;
  }
>()("t3/orchestration-v2/ThreadStatusReports") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;

  const storeImage = Effect.fn("ThreadStatusReports.storeImage")(function* (
    threadId: ThreadId,
    imagePath: string,
  ) {
    const unreadable = (cause: unknown) =>
      new ThreadStatusReportImageUnreadableError({ path: imagePath, cause });
    const info = yield* fileSystem.stat(imagePath).pipe(Effect.mapError(unreadable));
    if (info.type !== "File") return yield* unreadable(new Error("Not a file."));
    if (Number(info.size) > MAX_IMAGE_BYTES) {
      return yield* new ThreadStatusReportImageTooLargeError({
        path: imagePath,
        sizeBytes: Number(info.size),
      });
    }
    const bytes = yield* fileSystem.readFile(imagePath).pipe(Effect.mapError(unreadable));
    const digest = yield* crypto.digest("SHA-256", bytes).pipe(Effect.orDie);
    // Same bytes on the same thread keep one copy, so repeated updates do not pile up files.
    const attachmentId = createDeterministicAttachmentId(
      threadId,
      `status-report:${Hex.encode(digest)}`,
    );
    const extension = path
      .extname(imagePath)
      .toLowerCase()
      .replace(/^\.jpeg$/, ".jpg");
    const target =
      attachmentId === null
        ? null
        : resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}${extension}`,
          });
    if (attachmentId === null || target === null) {
      return yield* new ThreadStatusReportStoreError({
        threadId,
        cause: new Error("Invalid thread id."),
      });
    }
    if (!(yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false)))) {
      yield* fileSystem
        .writeFile(target, bytes)
        .pipe(Effect.mapError((cause) => new ThreadStatusReportStoreError({ threadId, cause })));
    }
    return attachmentId;
  });

  const set: ThreadStatusReports["Service"]["set"] = Effect.fn("ThreadStatusReports.set")(
    function* (input) {
      const paths = localImagePaths(input.report);
      if (paths.length > 0 && !input.readLocalImages) {
        return yield* new ThreadStatusReportLocalImagesRefusedError();
      }
      if (paths.length > MAX_IMAGES) {
        return yield* new ThreadStatusReportTooManyImagesError({ count: paths.length });
      }
      const stored = new Map<string, string>();
      for (const imagePath of paths) {
        stored.set(imagePath, yield* storeImage(input.threadId, imagePath));
      }
      const text = linkStoredImages(input.report, stored).trim();
      const { thread } = yield* engine.getThreadRecords(input.threadId, []);
      const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      yield* engine.dispatch({
        type: "thread.status-report.set",
        commandId: CommandId.make(`server:status-report:${input.threadId}:${uuid}`),
        threadId: input.threadId,
        text,
      });
      // Screenshots only the replaced report showed have nothing left pointing at them.
      const kept = new Set(threadStatusReportAttachmentIds(input.threadId, text));
      const replaced = threadStatusReportAttachmentIds(input.threadId, thread.statusReport?.text);
      yield* Effect.forEach(
        replaced.filter((attachmentId) => !kept.has(attachmentId)),
        (attachmentId) => {
          const file = resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId,
          });
          return file === null ? Effect.void : fileSystem.remove(file).pipe(Effect.ignore);
        },
        { discard: true },
      );
      return { storedImages: new Set(stored.values()).size };
    },
  );

  return ThreadStatusReports.of({ set });
});

export const layer = Layer.effect(ThreadStatusReports, make);
