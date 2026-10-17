import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as UserNotifications from "../../../notifications/UserNotifications.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { NotificationsToolkit } from "./tools.ts";

export const NotificationsToolkitHandlersLive = NotificationsToolkit.toLayer({
  notify_user: (input) =>
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
});
