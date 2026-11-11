import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createContextBreakdownEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Claude counts each category with its token-count API: count once per expand, never in the background,
    // and drop the result when the panel closes so a reopen is never stale.
    breakdown: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread:context-breakdown",
      tag: WS_METHODS.threadContextBreakdown,
      staleTimeMs: Number.POSITIVE_INFINITY,
      idleTtlMs: 0,
    }),
  };
}
