import { describe, expect, it } from "vite-plus/test";

import { cycleAppMode, readAppMode, setAppMode } from "./appMode";
import { useHomeOverlayStore } from "./homeOverlayStore";

describe("app mode", () => {
  it("maps the three modes onto Home's open state and view", () => {
    setAppMode("classic");
    expect(useHomeOverlayStore.getState().open).toBe(true);
    expect(readAppMode()).toBe("classic");
    setAppMode("normal");
    expect(useHomeOverlayStore.getState().open).toBe(false);
    expect(readAppMode()).toBe("normal");
    setAppMode("grow");
    expect(readAppMode()).toBe("grow");
  });

  it("cycles Grow, Manager, T3 and back", () => {
    setAppMode("grow");
    cycleAppMode();
    expect(readAppMode()).toBe("classic");
    cycleAppMode();
    expect(readAppMode()).toBe("normal");
    cycleAppMode();
    expect(readAppMode()).toBe("grow");
  });
});
