import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** Starts or stops a thread's preview environment (the project's t3.json `preview` commands). */
export function createPreviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    set: createEnvironmentRpcCommand(runtime, {
      label: "preview-environment:set",
      tag: WS_METHODS.threadPreviewEnvironment,
    }),
  };
}
