import { describe, expect, it } from "vite-plus/test";

import { cycleAppMode, readAppMode, setAppMode } from "./appMode";
import { useHomeOverlayStore } from "./homeOverlayStore";

describe("app mode", () => {
  it("maps Grow and T3 onto Home's open state", () => {
    setAppMode("grow");
    expect(useHomeOverlayStore.getState().open).toBe(true);
    expect(readAppMode()).toBe("grow");
    setAppMode("normal");
    expect(useHomeOverlayStore.getState().open).toBe(false);
    expect(readAppMode()).toBe("normal");
  });

  it("switches between Grow and T3", () => {
    setAppMode("grow");
    cycleAppMode();
    expect(readAppMode()).toBe("normal");
    cycleAppMode();
    expect(readAppMode()).toBe("grow");
  });
});
