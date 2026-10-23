import * as Effect from "effect/Effect";

import { describeElements } from "../../../elements/ElementsLibrary.ts";
import { ElementsToolkit } from "./tools.ts";

export const ElementsHandlersLive = ElementsToolkit.toLayer({
  elements_describe: (input) => Effect.sync(() => describeElements(input.tags)),
});
