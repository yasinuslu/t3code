import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

const ElementsDescribeTool = Tool.make("elements_describe", {
  description:
    "Read the web-component library's full entries: description, body kind, props JSON schema, example and whether it is interactive. Call it with the tags you are about to render when you have not used them in this thread or are unsure about props. An unknown tag returns an error entry with close names. An empty list returns the compact catalog.",
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

const RenderComponentTool = Tool.make("render_component", {
  description:
    "Show a web component to the user in your reply, at this point: text you wrote before the call appears above it, text after it below. The props are checked against the component's schema; a wrong shape returns an error naming what to fix, the schema and an example, and nothing is shown until a call succeeds, so fix it and call again. An interactive component sends the user's choice back as their next message: end your turn after showing one.",
  parameters: Schema.Struct({
    tag: Schema.String.annotate({ description: "The component tag, for example `t3-decision`." }),
    props: Schema.Record(Schema.String, Schema.Unknown).annotate({
      description:
        "The component's props as one JSON object (for a text-body component, the body is the prop named in its catalog entry).",
    }),
  }),
  success: Schema.Struct({ shown: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
})
  .annotate(Tool.Title, "Show a web component")
  // Claude Code defers MCP tools behind tool search; this one is how replies are written.
  .annotate(Tool.Meta, { "anthropic/alwaysLoad": true })
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ElementsToolkit = Toolkit.make(ElementsDescribeTool, RenderComponentTool);
