import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PreviewEnvironmentService from "../../../previewEnvironment/PreviewEnvironmentService.ts";
import { readWritableThread, unavailable } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PreviewEnvironmentToolkit } from "./tools.ts";

const toFailure = (error: PreviewEnvironmentService.PreviewEnvironmentError) =>
  error.reason === "unavailable"
    ? unavailable()
    : new OrchestratorMcpFailure({
        code: error.reason === "thread-not-found" ? "thread_not_found" : "invalid_request",
        message: error.message,
      });

const act = Effect.fn("PreviewEnvironmentHandlers.act")(function* (
  action: "up" | "down",
  requested: ThreadId | undefined,
) {
  const { projection } = yield* readWritableThread(requested);
  const threadId = projection.thread.id;
  const service = yield* PreviewEnvironmentService.PreviewEnvironmentService;
  yield* service[action](threadId).pipe(Effect.mapError(toFailure));
  return { threadId, status: action === "up" ? ("starting" as const) : ("stopping" as const) };
});

export const layer = McpToolAccess.toLayer(PreviewEnvironmentToolkit, {
  preview_environment_up: McpToolAccess.writes((input) => act("up", input.threadId)),
  preview_environment_down: McpToolAccess.writes((input) => act("down", input.threadId)),
});
