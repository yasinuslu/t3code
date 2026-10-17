import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type UserNotificationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as UserNotifications from "../../../notifications/UserNotifications.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { NotificationsToolkitHandlersLive } from "./handlers.ts";
import { NotificationsToolkit } from "./tools.ts";

const scopeWith = (capabilities: ReadonlyArray<"orchestration">) =>
  ({
    environmentId: EnvironmentId.make("notify-environment"),
    threadId: ThreadId.make("notify-thread"),
    providerSessionId: "notify-provider-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(capabilities),
    issuedAt: 0,
  }) satisfies McpInvocationContext.McpInvocationScope;

const callNotifyUser = (capabilities: ReadonlyArray<"orchestration">) =>
  Effect.gen(function* () {
    const received: UserNotificationInput[] = [];
    const dependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, scopeWith(capabilities)),
      Layer.mock(UserNotifications.UserNotifications)({
        notify: (input) =>
          Effect.sync(() => {
            received.push(input);
            return {
              notification: {
                id: "n1",
                title: input.title,
                body: input.body,
                priority: input.priority ?? "normal",
                createdAt: "2026-10-14T08:00:00.000Z",
              },
              deduped: false,
              pushed: 1,
            };
          }),
      }),
    );
    const toolkit = yield* NotificationsToolkit.pipe(
      Effect.provide(NotificationsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const emitted = yield* toolkit
      .handle("notify_user", { title: "🚩 Flag", body: "one line", priority: "urgent" })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    return { received, result: emitted.at(-1)?.result };
  });

it.effect("notify_user passes the call to the service and returns its result", () =>
  Effect.gen(function* () {
    const { received, result } = yield* callNotifyUser(["orchestration"]);
    expect(received).toEqual([{ title: "🚩 Flag", body: "one line", priority: "urgent" }]);
    expect(result).toMatchObject({ pushed: 1, deduped: false });
  }),
);

it.effect("notify_user is denied without the orchestration capability", () =>
  Effect.gen(function* () {
    const { received, result } = yield* callNotifyUser([]);
    expect(received).toEqual([]);
    expect(result).toMatchObject({ code: "capability_denied" });
  }),
);
