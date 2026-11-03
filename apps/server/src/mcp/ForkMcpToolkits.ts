import type { ForkFeature } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { McpSchema, type Tool, Toolkit } from "effect/ai";

import { whenForkFeature } from "../forkFeatures.ts";
import * as PeerEnvironments from "../peers/PeerEnvironments.ts";
import { layerMcpTransport, toolkitRegistration } from "./McpHttpServer.ts";
import * as BrainstormHandlers from "./toolkits/brainstorm/handlers.ts";
import { BrainstormToolkit } from "./toolkits/brainstorm/tools.ts";
import * as ElementsHandlers from "./toolkits/elements/handlers.ts";
import { ElementsToolkit } from "./toolkits/elements/tools.ts";
import * as PeersHandlers from "./toolkits/peers/handlers.ts";
import { PeersToolkit } from "./toolkits/peers/tools.ts";
import * as PresentationHandlers from "./toolkits/presentation/handlers.ts";
import { PresentationToolkit } from "./toolkits/presentation/tools.ts";
import * as PreviewEnvironmentHandlers from "./toolkits/previewEnvironment/handlers.ts";
import { PreviewEnvironmentToolkit } from "./toolkits/previewEnvironment/tools.ts";
import * as PreviewLinksHandlers from "./toolkits/previewLinks/handlers.ts";
import { PreviewLinksToolkit } from "./toolkits/previewLinks/tools.ts";

/**
 * Hides every tool of `toolkit` while `feature` is off, on top of any visibility
 * the tool already has. The MCP core checks it for both listing and calling.
 */
export const gateToolkit = <Tools extends Record<string, Tool.Any>>(
  feature: ForkFeature,
  toolkit: Toolkit.Toolkit<Tools>,
): Toolkit.Toolkit<Tools> => {
  const featureOn = whenForkFeature(feature);
  const tools = Object.values(toolkit.tools).map((tool: Tool.Any) => {
    const existing = Context.getOrUndefined(tool.annotations, McpSchema.EnabledWhen);
    return tool.annotate(
      McpSchema.EnabledWhen,
      existing === undefined ? featureOn : (client) => featureOn() && existing(client),
    );
  });
  // Same tools under the same names, so the handler layers still fit.
  return Toolkit.make(...tools) as unknown as Toolkit.Toolkit<Tools>;
};

/** The fork's MCP tools, each toolkit behind its feature flag. */
export const layer = Layer.mergeAll(
  toolkitRegistration(gateToolkit("previews", PreviewLinksToolkit), PreviewLinksHandlers.layer),
  toolkitRegistration(
    gateToolkit("previews", PreviewEnvironmentToolkit),
    PreviewEnvironmentHandlers.layer,
  ),
  toolkitRegistration(gateToolkit("presentation", PresentationToolkit), PresentationHandlers.layer),
  toolkitRegistration(gateToolkit("webComponents", ElementsToolkit), ElementsHandlers.layer),
  toolkitRegistration(gateToolkit("manager", BrainstormToolkit), BrainstormHandlers.layer),
  toolkitRegistration(gateToolkit("peers", PeersToolkit), PeersHandlers.layer).pipe(
    Layer.provide(PeerEnvironments.layer),
  ),
).pipe(Layer.provideMerge(layerMcpTransport));
