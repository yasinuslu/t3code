import * as Effect from "effect/Effect";

import { describeElements } from "../../../elements/ElementsLibrary.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ElementsToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ElementsToolkit, {
  elements_describe: McpToolAccess.reads((input) =>
    Effect.sync(() => describeElements(input.tags)),
  ),
});
