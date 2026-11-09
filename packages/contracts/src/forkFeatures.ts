import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Features this fork adds on top of upstream T3 Code. Each one is gated at its
 * edges (tool registration, agent instructions, UI entry points, service
 * wiring), so turning every flag off behaves like upstream.
 */
export const FORK_FEATURES = [
  "manager",
  "codeProfiles",
  "spaces",
  "accountBalancing",
  "webComponents",
  "previews",
  "presentation",
  "keybindings",
  "peers",
] as const;
export type ForkFeature = (typeof FORK_FEATURES)[number];

const featureFlag = Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true)));

export const ForkFeatures = Schema.Struct({
  manager: featureFlag,
  codeProfiles: featureFlag,
  spaces: featureFlag,
  accountBalancing: featureFlag,
  webComponents: featureFlag,
  previews: featureFlag,
  presentation: featureFlag,
  keybindings: featureFlag,
  peers: featureFlag,
});
export type ForkFeatures = typeof ForkFeatures.Type;

export const DEFAULT_FORK_FEATURES: ForkFeatures = Schema.decodeSync(ForkFeatures)({});

export const ForkFeaturesPatch = Schema.Struct({
  manager: Schema.optionalKey(Schema.Boolean),
  codeProfiles: Schema.optionalKey(Schema.Boolean),
  spaces: Schema.optionalKey(Schema.Boolean),
  accountBalancing: Schema.optionalKey(Schema.Boolean),
  webComponents: Schema.optionalKey(Schema.Boolean),
  previews: Schema.optionalKey(Schema.Boolean),
  presentation: Schema.optionalKey(Schema.Boolean),
  keybindings: Schema.optionalKey(Schema.Boolean),
  peers: Schema.optionalKey(Schema.Boolean),
});
export type ForkFeaturesPatch = typeof ForkFeaturesPatch.Type;

/** Missing settings (an old client, a test fixture) count as the defaults. */
export function isForkFeatureOn(
  settings: { readonly forkFeatures?: ForkFeatures | undefined } | null | undefined,
  feature: ForkFeature,
): boolean {
  return (settings?.forkFeatures ?? DEFAULT_FORK_FEATURES)[feature];
}
