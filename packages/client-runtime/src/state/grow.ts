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
    /** Starts or stops a thread's preview environment (the project's t3.json `preview` commands). */
    previewEnvironment: createEnvironmentRpcCommand(runtime, {
      label: "grow:preview-environment",
      tag: WS_METHODS.threadPreviewEnvironment,
    }),
    /** The web-component library assistant markdown renders inline (exp/web-components). */
    elementsLibrary: createEnvironmentRpcCommand(runtime, {
      label: "elements:library",
      tag: WS_METHODS.elementsLibrary,
    }),
    /** The workspace's widget pool, compiled for the living page's frame. */
    widgetPool: createEnvironmentRpcCommand(runtime, {
      label: "grow:widget-pool",
      tag: WS_METHODS.growWidgetPool,
    }),
  };
}
