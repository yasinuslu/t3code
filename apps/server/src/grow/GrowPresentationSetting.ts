/**
 * Keeps the presentation part of the provider instructions in step with the experimental
 * `growPresentation` setting: agents are asked to keep a presentation only while Grow shows it.
 *
 * @module GrowPresentationSetting
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { setPresentationInstructionsEnabled } from "../provider/RuntimeInstructions.ts";
import * as ServerSettings from "../serverSettings.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const changes = yield* serverSettings.subscribeChanges;
    const current = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.growPresentation),
      Effect.orElseSucceed(() => false),
    );
    setPresentationInstructionsEnabled(current);
    yield* Stream.runForEach(changes, (settings) =>
      Effect.sync(() => setPresentationInstructionsEnabled(settings.growPresentation)),
    ).pipe(Effect.forkScoped);
  }),
);
