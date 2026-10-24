import { THREAD_PRESENTATION_DOC_MAX_CHARS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import {
  applyPresentationEdit,
  presentationPages,
} from "../../../orchestration-v2/presentationVersions.ts";
import { newCommandId, readWritableThread, unavailable } from "../../threadAccess.ts";
import { writePresentationPages } from "../presentation/handlers.ts";
import { linkStoredImages, localImagePaths } from "./reportImages.ts";
import { invalid, storeImageFile } from "./storeFile.ts";
import { ThreadStatusToolkit } from "./tools.ts";

const MAX_IMAGES = 12;
/** The presentation page a status report lands on. */
const STATUS_PAGE_ID = "status";

export const ThreadStatusHandlersLive = ThreadStatusToolkit.toLayer({
  thread_status_update: (input) =>
    Effect.gen(function* () {
      const context = yield* readWritableThread(input.threadId);
      const { projection } = context;
      const threadId = projection.thread.id;

      const paths = localImagePaths(input.report);
      if (paths.length > MAX_IMAGES) {
        return yield* invalid(`A status report can carry at most ${MAX_IMAGES} screenshots.`);
      }
      const stored = new Map<string, string>();
      for (const imagePath of paths) {
        stored.set(imagePath, yield* storeImageFile(threadId, imagePath));
      }

      const linkedReport = linkStoredImages(input.report, stored).trim();
      const engine = yield* Orchestrator.OrchestratorV2;
      yield* engine
        .dispatch({
          type: "thread.status-report.set",
          commandId: yield* newCommandId(),
          threadId,
          text: linkedReport,
          ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        })
        .pipe(Effect.mapError(unavailable));
      // The presentation is the one place status lives: the report is also its first page, so an
      // agent that only knows this tool still feeds it. Best effort; the card above is the record.
      const pages = applyPresentationEdit(presentationPages(projection.thread.presentation), {
        put: [{ kind: "doc", id: STATUS_PAGE_ID, title: "Status", markdown: linkedReport }],
        order: [STATUS_PAGE_ID],
      });
      if (typeof pages !== "string" && linkedReport.length <= THREAD_PRESENTATION_DOC_MAX_CHARS) {
        yield* writePresentationPages(context, pages).pipe(Effect.ignore);
      }
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
