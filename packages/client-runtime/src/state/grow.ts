import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** The Grow board's cards (see the server's GrowService). */
export function createGrowEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:grow:state",
      tag: WS_METHODS.subscribeGrow,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "grow:update",
      tag: WS_METHODS.growUpdate,
    }),
  };
}
