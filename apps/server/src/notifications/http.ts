import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as UserNotifications from "./UserNotifications.ts";

export const notificationsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "notifications",
  Effect.fnUntraced(function* (handlers) {
    const notifications = yield* UserNotifications.UserNotifications;

    return handlers.handle(
      "notify",
      Effect.fn("environment.notifications.notify")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
        return yield* notifications.notify(args.payload).pipe(
          Effect.catchIf(
            (error) => error.reason === "invalid_input",
            () => failEnvironmentInvalidRequest("invalid_command"),
          ),
          Effect.catch((error) => failEnvironmentInternal("internal_error", error)),
        );
      }),
    );
  }),
);
