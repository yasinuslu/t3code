import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import { describe, expect, it } from "vite-plus/test";

import { setForkFeaturesForTest } from "./forkFeatures.ts";
import "./forkInstructions.ts";

const withFlags = (flags: Parameters<typeof setForkFeaturesForTest>[0], read: () => string) => {
  const previous = setForkFeaturesForTest(flags);
  try {
    return read();
  } finally {
    setForkFeaturesForTest(previous);
  }
};

describe("fork runtime instructions", () => {
  it("adds the preview and presentation sections while their features are on", () => {
    const text = withFlags({ previews: true, presentation: true }, () =>
      buildRuntimeInstructions({ harness: "Codex" }),
    );
    expect(text).toContain("<preview_linking>");
    expect(text).toContain("<presentation>");
  });

  it("leaves the upstream instructions alone with every feature off", () => {
    const text = withFlags({ previews: false, presentation: false, webComponents: false }, () =>
      buildRuntimeInstructions({ harness: "Codex" }),
    );
    expect(text).not.toContain("<preview_linking>");
    expect(text).not.toContain("<presentation>");
    expect(text).not.toContain("<web_components>");
    expect(text.endsWith("</pull_request_linking>")).toBe(true);
  });
});
