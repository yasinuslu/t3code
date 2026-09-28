import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Brainstorm chats and their task lists (see the server's BrainstormService). */
export function createBrainstormEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:brainstorm:state",
      tag: WS_METHODS.subscribeBrainstorm,
    }),
    syncSpaces: createEnvironmentRpcCommand(runtime, {
      label: "brainstorm:sync-spaces",
      tag: WS_METHODS.brainstormSyncSpaces,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "brainstorm:open",
      tag: WS_METHODS.brainstormOpen,
    }),
    mutateTasks: createEnvironmentRpcCommand(runtime, {
      label: "brainstorm:tasks",
      tag: WS_METHODS.brainstormMutateTasks,
    }),
  };
}
