import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { createDeterministicAttachmentId } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { newCommandId, readWritableThread, unavailable } from "../../threadAccess.ts";
import { linkStoredImages, localImagePaths } from "./reportImages.ts";
import { ThreadStatusToolkit } from "./tools.ts";

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

export const ThreadStatusHandlersLive = ThreadStatusToolkit.toLayer({
  thread_status_update: (input) =>
    Effect.gen(function* () {
      const { projection } = yield* readWritableThread(input.threadId);
      const threadId = projection.thread.id;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;

      const paths = localImagePaths(input.report);
      if (paths.length > MAX_IMAGES) {
        return yield* invalid(`A status report can carry at most ${MAX_IMAGES} screenshots.`);
      }
      // Same bytes on the same thread keep one copy, so repeated updates do not pile up files.
      const stored = new Map<string, string>();
      for (const imagePath of paths) {
        const bytes = yield* fileSystem
          .readFile(imagePath)
          .pipe(Effect.mapError(() => invalid(`Could not read screenshot ${imagePath}.`)));
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return yield* invalid(`Screenshot ${imagePath} is larger than 16 MB.`);
        }
        const hash = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
        const attachmentId = createDeterministicAttachmentId(threadId, hash);
        if (attachmentId === null) return yield* unavailable();
        const extension = path.extname(imagePath).toLowerCase().replace(".jpeg", ".jpg");
        const target = path.join(config.attachmentsDir, `${attachmentId}${extension}`);
        if (!(yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false)))) {
          yield* fileSystem.writeFile(target, bytes).pipe(Effect.mapError(unavailable));
        }
        stored.set(imagePath, attachmentId);
      }

      const engine = yield* Orchestrator.OrchestratorV2;
      yield* engine
        .dispatch({
          type: "thread.status-report.set",
          commandId: yield* newCommandId(),
          threadId,
          text: linkStoredImages(input.report, stored).trim(),
        })
        .pipe(Effect.mapError(unavailable));
      return { threadId, storedImages: stored.size };
    }),
});
