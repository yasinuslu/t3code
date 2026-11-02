import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** The web-component library that assistant markdown renders inline. */
export function createElementsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    library: createEnvironmentRpcCommand(runtime, {
      label: "elements:library",
      tag: WS_METHODS.elementsLibrary,
    }),
  };
}
