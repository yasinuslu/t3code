import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ThreadStatusReports from "../../../orchestration-v2/ThreadStatusReports.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, readThread, unavailable } from "../../threadAccess.ts";
import { ThreadStatusToolkit } from "./tools.ts";

type SetError = Effect.Error<ReturnType<ThreadStatusReports.ThreadStatusReports["Service"]["set"]>>;

// Image and limit errors are built on the server and tell the agent what to fix.
const toFailure = (error: SetError) => {
  switch (error._tag) {
    case "ThreadStatusReportLocalImagesRefusedError":
    case "ThreadStatusReportTooManyImagesError":
    case "ThreadStatusReportImageUnreadableError":
    case "ThreadStatusReportImageTooLargeError":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "ThreadStatusReportStoreError":
      return unavailable();
    default:
      return dispatchFailure(error);
  }
};

export const layer = McpToolAccess.toLayer(ThreadStatusToolkit, {
  thread_status_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { scope, projection } = yield* readThread(input.threadId);
        const reports = yield* ThreadStatusReports.ThreadStatusReports;
        const { storedImages } = yield* reports
          .set({
            threadId: projection.thread.id,
            report: input.report,
            // Only an agent T3 launched, which already works on this machine, may read its files.
            readLocalImages: scope.thread !== undefined,
          })
          .pipe(Effect.mapError(toFailure));
        return { threadId: projection.thread.id, storedImages };
      }),
  ),
});
