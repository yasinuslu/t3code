import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { FORK_FEATURES, isForkFeatureOn } from "./forkFeatures.ts";
import { ServerSettings } from "./settings.ts";

const decode = Schema.decodeUnknownSync(ServerSettings);

describe("fork features", () => {
  it("turns every feature on when the settings file names none", () => {
    const settings = decode({});
    for (const feature of FORK_FEATURES) expect(isForkFeatureOn(settings, feature)).toBe(true);
  });

  it("keeps the features a file turns off and defaults the rest", () => {
    const settings = decode({ forkFeatures: { manager: false, previews: false } });
    expect(FORK_FEATURES.filter((feature) => !isForkFeatureOn(settings, feature))).toEqual([
      "manager",
      "previews",
    ]);
  });

  it("treats settings from a server without the field as all on", () => {
    expect(isForkFeatureOn(undefined, "presentation")).toBe(true);
    expect(isForkFeatureOn({}, "presentation")).toBe(true);
  });
});
