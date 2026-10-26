import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as UserNotifications from "../../../notifications/UserNotifications.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { NotificationsToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(NotificationsToolkit, {
  notify_user: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      if (!scope.capabilities.has("orchestration")) {
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This credential cannot notify the user.",
        });
      }
      const notifications = yield* UserNotifications.UserNotifications;
      return yield* notifications
        .notify(input)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
    }),
  ),
});
