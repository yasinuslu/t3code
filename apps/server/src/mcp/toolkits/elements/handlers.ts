import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { describeElements, renderComponent } from "../../../elements/ElementsLibrary.ts";
import { ElementsToolkit } from "./tools.ts";

export const ElementsHandlersLive = ElementsToolkit.toLayer({
  elements_describe: (input) => Effect.sync(() => describeElements(input.tags)),
  // The web draws the call's input in place; this only decides whether it may.
  render_component: (input) =>
    Effect.suspend(() => {
      const result = renderComponent(input.tag, input.props);
      return result.ok
        ? Effect.succeed({
            shown: result.interactive
              ? `${result.tag} is shown. The user's answer arrives as their next message.`
              : `${result.tag} is shown. Lead into the next component with its call's text, and end with reply text.`,
          })
        : Effect.fail(
            new OrchestratorMcpFailure({ code: "invalid_request", message: result.message }),
          );
    }),
});
