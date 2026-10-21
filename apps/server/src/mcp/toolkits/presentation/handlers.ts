import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { newCommandId, readWritableThread, unavailable } from "../../threadAccess.ts";
import { invalid, storeImageFile, storeThreadFile } from "../threadStatus/storeFile.ts";
import { storePresentationPages } from "./pages.ts";
import { PresentationToolkit } from "./tools.ts";

export const PresentationHandlersLive = PresentationToolkit.toLayer({
  presentation_set: (input) =>
    Effect.gen(function* () {
      const { projection } = yield* readWritableThread(input.threadId);
      const threadId = projection.thread.id;
      const fileSystem = yield* FileSystem.FileSystem;
      const pages = yield* storePresentationPages(input.pages, {
        image: (path) => storeImageFile(threadId, path),
        html: (source) =>
          Effect.gen(function* () {
            const bytes =
              "html" in source
                ? new TextEncoder().encode(source.html)
                : yield* fileSystem
                    .readFile(source.path)
                    .pipe(Effect.mapError(() => invalid(`Could not read ${source.path}.`)));
            return yield* storeThreadFile({ threadId, bytes, extension: ".html", generic: true });
          }),
      });
      const engine = yield* Orchestrator.OrchestratorV2;
      yield* engine
        .dispatch({
          type: "thread.presentation.set",
          commandId: yield* newCommandId(),
          threadId,
          pages,
        })
        .pipe(Effect.mapError(unavailable));
      return { threadId, pages: pages.length };
    }),
});
