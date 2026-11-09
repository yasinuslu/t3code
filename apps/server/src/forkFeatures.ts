import {
  DEFAULT_FORK_FEATURES,
  type ForkFeature,
  type ForkFeatures,
  isForkFeatureOn,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSettings from "./serverSettings.ts";

// MCP visibility predicates and provider instructions are synchronous and run
// outside any service context, so the flags are mirrored here from settings.
let current: ForkFeatures = DEFAULT_FORK_FEATURES;

/** The flag as last read from settings; every flag is on until the layer reads them. */
export const forkFeatureOn = (feature: ForkFeature): boolean => current[feature];

/** `McpSchema.EnabledWhen` for a fork feature's tools. */
export const whenForkFeature = (feature: ForkFeature) => (): boolean => forkFeatureOn(feature);

/** For effectful gates that should follow the settings file directly. */
export const readForkFeature = Effect.fn("ForkFeatures.read")(function* (feature: ForkFeature) {
  const service = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  if (Option.isNone(service)) return true;
  const settings = yield* service.value.getSettings.pipe(Effect.option);
  return Option.isNone(settings) || isForkFeatureOn(settings.value, feature);
});

/** Keeps the synchronous mirror in step with the settings file. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const changes = yield* serverSettings.subscribeChanges;
    const mirror = (settings: { readonly forkFeatures: ForkFeatures }) =>
      Effect.sync(() => {
        current = settings.forkFeatures;
      });
    // Whatever is cached now, then the file once it has loaded, then every change.
    yield* serverSettings.getSettings.pipe(Effect.flatMap(mirror), Effect.ignore);
    yield* serverSettings.ready.pipe(
      Effect.andThen(serverSettings.getSettings),
      Effect.flatMap(mirror),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* changes.pipe(Stream.runForEach(mirror), Effect.forkScoped);
  }),
);

/** Tests set the mirror directly; restore it with the returned flags. */
export const setForkFeaturesForTest = (next: Partial<ForkFeatures>): ForkFeatures => {
  const previous = current;
  current = { ...current, ...next };
  return previous;
};
