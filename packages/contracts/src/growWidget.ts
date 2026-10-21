import * as Schema from "effect/Schema";

/**
 * One widget of the workspace's pool, compiled for Grow's sandboxed frame: `code` is CommonJS
 * that imports only what the frame provides, `meta` is what the page writer and the gallery read.
 */
export const GrowWidget = Schema.Struct({
  name: Schema.String,
  code: Schema.String,
  meta: Schema.Struct({
    description: Schema.String,
    /** JSON Schema of the props. */
    props: Schema.Record(Schema.String, Schema.Unknown),
    /** Props for the gallery and for the writer to imitate. */
    example: Schema.Record(Schema.String, Schema.Unknown),
  }),
});
export type GrowWidget = typeof GrowWidget.Type;

/** The pool as the client sees it; `configured` is false when no pool folder is set. */
export const GrowWidgetPoolState = Schema.Struct({
  configured: Schema.Boolean,
  dir: Schema.String,
  widgets: Schema.Array(GrowWidget),
  broken: Schema.Array(Schema.Struct({ name: Schema.String, error: Schema.String })),
});
export type GrowWidgetPoolState = typeof GrowWidgetPoolState.Type;
