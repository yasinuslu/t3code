import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** The owner's inbox and push devices (see the server's UserNotifications). */
export function createNotificationsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:notifications:state",
      tag: WS_METHODS.subscribeNotifications,
    }),
    notify: createEnvironmentRpcCommand(runtime, {
      label: "notifications:notify",
      tag: WS_METHODS.notificationsNotify,
    }),
    markRead: createEnvironmentRpcCommand(runtime, {
      label: "notifications:mark-read",
      tag: WS_METHODS.notificationsMarkRead,
    }),
    pushSubscribe: createEnvironmentRpcCommand(runtime, {
      label: "notifications:push-subscribe",
      tag: WS_METHODS.notificationsPushSubscribe,
    }),
    pushUnsubscribe: createEnvironmentRpcCommand(runtime, {
      label: "notifications:push-unsubscribe",
      tag: WS_METHODS.notificationsPushUnsubscribe,
    }),
  };
}
