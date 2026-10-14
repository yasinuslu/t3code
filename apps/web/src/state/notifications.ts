import { useAtomValue } from "@effect/atom-react";
import { createNotificationsEnvironmentAtoms } from "@t3tools/client-runtime/state/notifications";
import type { EnvironmentId, UserNotificationsState } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { useEnvironmentQuery } from "./query";

export const notificationsEnvironment = createNotificationsEnvironmentAtoms(connectionAtomRuntime);

/**
 * The owner's inbox on the primary environment, the one this app is served from. A browser
 * push subscription is bound to one server key, so push and the inbox both live there.
 * `state` is null until the first snapshot arrives (or when the server predates the feature).
 */
export function usePrimaryNotifications(): {
  readonly environmentId: EnvironmentId | null;
  readonly state: UserNotificationsState | null;
} {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId ? notificationsEnvironment.state({ environmentId, input: {} }) : null,
  );
  return { environmentId, state: environmentId ? query.data : null };
}
