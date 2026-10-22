import * as Schema from "effect/Schema";

/**
 * One component of the web-component library (yasinuslu/t3-elements) that assistant markdown
 * may use as a custom element, e.g. `<t3-decision>`. `meta` is the component's manifest.json.
 */
export const ElementManifest = Schema.Struct({
  tag: Schema.String,
  description: Schema.String,
  /** `json`: the element's text is a JSON object of props; `text:<prop>`: it is that prop. */
  body: Schema.optional(Schema.String),
  /** JSON Schema of the props. */
  props: Schema.Record(Schema.String, Schema.Unknown),
  example: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  interactive: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
});
export type ElementManifest = typeof ElementManifest.Type;

/**
 * The library as the client loads it. `bundle` is the ESM that defines every element; it is left
 * out when the client already has the bundle with this `hash`.
 */
export const ElementsLibraryState = Schema.Struct({
  configured: Schema.Boolean,
  hash: Schema.String,
  version: Schema.String,
  components: Schema.Array(ElementManifest),
  bundle: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type ElementsLibraryState = typeof ElementsLibraryState.Type;

export const ElementsLibraryInput = Schema.Struct({
  knownHash: Schema.optional(Schema.String),
});
