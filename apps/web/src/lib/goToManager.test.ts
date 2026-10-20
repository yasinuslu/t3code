import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeHomeOverlay,
  homeOverlayHeldOpen,
  openHomeOverlay,
  useHomeOverlayStore,
} from "../homeOverlayStore";
import { useManagerViewStore } from "../managerViewStore";
import { returnFromManager, toggleManager } from "./goToManager";

const growOpen = () => useHomeOverlayStore.getState().open;

beforeEach(() => {
  vi.stubGlobal("window", { requestAnimationFrame: (run: () => void) => setTimeout(run, 0) });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeHomeOverlay();
  useManagerViewStore.setState({ shown: false, request: null, returnTo: null });
});

describe("the manager shortcut in Grow", () => {
  it("shows the manager from Grow, also when Grow is over the manager's own page", async () => {
    openHomeOverlay();
    toggleManager();
    await vi.waitFor(() => expect(useManagerViewStore.getState().request).toBe("show"));

    useManagerViewStore.setState({ shown: true, request: null });
    toggleManager();
    await vi.waitFor(() => expect(useManagerViewStore.getState().request).toBe("show"));
  });

  it("hides the manager when it shows with Grow closed", () => {
    useManagerViewStore.setState({ shown: true });
    toggleManager();
    expect(useManagerViewStore.getState().request).toBe("hide");
  });
});

describe("going back from the manager to Grow", () => {
  it("brings Grow up before the page under it has loaded, and holds it there until then", async () => {
    let finishNavigation: () => void = () => undefined;
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = resolve;
    });
    const navigate = vi.fn(() => navigation);

    const returning = returnFromManager({ href: "/env/thread", grow: true }, navigate);

    expect(navigate).toHaveBeenCalledWith("/env/thread");
    expect(growOpen()).toBe(true);
    expect(homeOverlayHeldOpen()).toBe(true);

    finishNavigation();
    await returning;
    expect(growOpen()).toBe(true);
    expect(homeOverlayHeldOpen()).toBe(false);
  });

  it("lets Grow go again if the page cannot be reached", async () => {
    await returnFromManager({ href: "/gone", grow: true }, () => Promise.reject(new Error("no")));
    expect(homeOverlayHeldOpen()).toBe(false);
  });

  it("leaves Grow closed when the manager was opened from a page", async () => {
    await returnFromManager({ href: "/env/thread", grow: false }, () => Promise.resolve());
    expect(growOpen()).toBe(false);
    expect(homeOverlayHeldOpen()).toBe(false);
  });
});
