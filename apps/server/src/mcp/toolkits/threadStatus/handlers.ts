import * as Effect from "effect/Effect";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { newCommandId, readWritableThread, unavailable } from "../../threadAccess.ts";
import { linkStoredImages, localImagePaths } from "./reportImages.ts";
import { invalid, storeImageFile } from "./storeFile.ts";
import { ThreadStatusToolkit } from "./tools.ts";

const MAX_IMAGES = 12;

export const ThreadStatusHandlersLive = ThreadStatusToolkit.toLayer({
  thread_status_update: (input) =>
    Effect.gen(function* () {
      const { projection } = yield* readWritableThread(input.threadId);
      const threadId = projection.thread.id;

      const paths = localImagePaths(input.report);
      if (paths.length > MAX_IMAGES) {
        return yield* invalid(`A status report can carry at most ${MAX_IMAGES} screenshots.`);
      }
      const stored = new Map<string, string>();
      for (const imagePath of paths) {
        stored.set(imagePath, yield* storeImageFile(threadId, imagePath));
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
      return stored.size > 0
        ? { threadId, storedImages: stored.size }
        : {
            threadId,
            storedImages: 0,
            warning:
              "No proof image. Before the final report, add one (a marked screenshot of the result, a short GIF for motion, or an image of the evidence) as a markdown image with an absolute path.",
          };
    }),
});
