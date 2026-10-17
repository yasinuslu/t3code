import { afterEach, describe, expect, it } from "vitest";

import {
  closeHomeOverlay,
  openHomeOverlay,
  setHomeOverlayEnabled,
  toggleHomeOverlay,
  useHomeOverlayStore,
} from "./homeOverlayStore";

describe("Home while the fork features are off", () => {
  afterEach(() => {
    setHomeOverlayEnabled(true);
    closeHomeOverlay();
  });

  it("closes an open Home and refuses to open it again", () => {
    openHomeOverlay();
    expect(useHomeOverlayStore.getState().open).toBe(true);

    setHomeOverlayEnabled(false);
    expect(useHomeOverlayStore.getState().open).toBe(false);

    openHomeOverlay();
    toggleHomeOverlay();
    expect(useHomeOverlayStore.getState().open).toBe(false);
  });

  it("opens again once the features are back on", () => {
    setHomeOverlayEnabled(false);
    setHomeOverlayEnabled(true);
    openHomeOverlay();
    expect(useHomeOverlayStore.getState().open).toBe(true);
  });
});
