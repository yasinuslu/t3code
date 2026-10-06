import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
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
    /** Keyed by thread and run, so a finished run fetches the new report once. */
    threadReport: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:brainstorm:thread-report",
      tag: WS_METHODS.brainstormThreadReport,
      staleTimeMs: 60_000,
    }),
    mutateTasks: createEnvironmentRpcCommand(runtime, {
      label: "brainstorm:tasks",
      tag: WS_METHODS.brainstormMutateTasks,
    }),
  };
}
