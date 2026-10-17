import {
  AuthAdministrativeScopes,
  EnvironmentHttpApi,
  UserNotificationPriority,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export class NotifyServerNotRunningError extends Schema.TaggedError<NotifyServerNotRunningError>()(
  "NotifyServerNotRunningError",
  {},
) {
  override get message(): string {
    return "No running T3 Code server found for this data directory. Notifications are pushed by the server, so start it first.";
  }
}

export class NotifyRequestError extends Schema.TaggedError<NotifyRequestError>()(
  "NotifyRequestError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The running server did not accept the notification.";
  }
}

const notifyCommand = Command.make("notify", {
  baseDir: projectLocationFlags.baseDir,
  title: Flag.String("title").pipe(Flag.withDescription("Headline, one short line.")),
  body: Flag.String("body").pipe(
    Flag.withDescription("One or two plain sentences."),
    Flag.withDefault(""),
  ),
  link: Flag.String("link").pipe(
    Flag.withDescription("Where a tap goes: an https URL or an in-app path."),
    Flag.optional,
  ),
  priority: Flag.Literals("priority", UserNotificationPriority.literals).pipe(
    Flag.withDescription(
      "urgent: needs the user now. normal: worth a glance. quiet: inbox only, no push.",
    ),
    Flag.withDefault("normal" as const),
  ),
  tag: Flag.String("tag").pipe(
    Flag.withDescription("A later notification with the same tag replaces this one."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Send the user a notification through the running server."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir: flags.baseDir }, logLevel);
      return yield* Effect.gen(function* () {
        const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
        if (Option.isNone(runtimeState)) return yield* new NotifyServerNotRunningError({});
        const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const result = yield* Effect.acquireUseRelease(
          environmentAuth.issueSession({
            scopes: AuthAdministrativeScopes,
            label: "t3 notify cli",
          }),
          (issued) =>
            Effect.gen(function* () {
              const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
                baseUrl: runtimeState.value.origin,
              });
              return yield* client.notifications.notify({
                headers: { authorization: `Bearer ${issued.token}` },
                payload: {
                  title: flags.title,
                  body: flags.body,
                  priority: flags.priority,
                  ...(Option.isSome(flags.link) ? { link: flags.link.value } : {}),
                  ...(Option.isSome(flags.tag) ? { tag: flags.tag.value } : {}),
                },
              });
            }).pipe(Effect.mapError((cause) => new NotifyRequestError({ cause }))),
          (issued) =>
            environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
        );
        yield* Console.log(
          result.deduped
            ? "Already sent (same tag, same content)."
            : `Sent to the inbox, pushed to ${result.pushed} device(s).`,
        );
      }).pipe(
        Effect.provide(
          EnvironmentAuth.runtimeLayer.pipe(
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
          ),
        ),
      );
    }),
  ),
);

export { notifyCommand };
