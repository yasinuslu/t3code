import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

const ElementsDescribeTool = Tool.make("elements_describe", {
  description:
    "Read the web-component library's full entries: description, body kind, props JSON schema, example and whether it is interactive. Call it with the tags you are about to write when you have not used them in this thread or are unsure about props; a mistaken prop renders a visible error card. An unknown tag returns an error entry with close names. An empty list returns the compact catalog.",
  parameters: Schema.Struct({
    tags: Schema.Array(Schema.String).annotate({
      description: "Component tags, for example `t3-datatable`. Empty for the compact catalog.",
    }),
  }),
  success: Schema.Struct({
    catalog: Schema.optional(Schema.String),
    components: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
})
  .annotate(Tool.Title, "Describe web components")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ElementsToolkit = Toolkit.make(ElementsDescribeTool);
