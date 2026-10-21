import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGrowFocusStore } from "../growFocus";
import {
  closeHomeOverlay,
  setClassicThreadsView,
  homeOverlayHeldOpen,
  openHomeOverlay,
  useHomeOverlayStore,
} from "../homeOverlayStore";
import { useManagerViewStore } from "../managerViewStore";
import { returnFromManager, setGrowManagerToggle, toggleManager } from "./goToManager";

const growOpen = () => useHomeOverlayStore.getState().open;

beforeEach(() => {
  vi.stubGlobal("window", { requestAnimationFrame: (run: () => void) => setTimeout(run, 0) });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  // The manager's own page and the way back to it belong to the classic threads view.
  setClassicThreadsView(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeHomeOverlay();
  useManagerViewStore.setState({ shown: false, request: null, returnTo: null });
  useGrowFocusStore.setState({ target: null, manager: false });
});

describe("the manager shortcut with Grow as the main view", () => {
  it("brings up Grow with its manager pane from any page, and never the manager's page", async () => {
    setClassicThreadsView(false);
    useManagerViewStore.setState({ shown: true });
    toggleManager();
    await vi.waitFor(() => expect(useGrowFocusStore.getState().manager).toBe(true));
    expect(growOpen()).toBe(true);
    expect(useManagerViewStore.getState().request).toBeNull();
  });
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

  it("toggles Grow's own manager pane while Grow shows it, and leaves the page alone", async () => {
    const toggle = vi.fn();
    const unregister = setGrowManagerToggle(toggle);
    openHomeOverlay();
    toggleManager();
    await vi.waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
    expect(useManagerViewStore.getState().request).toBeNull();

    unregister();
    toggleManager();
    await vi.waitFor(() => expect(useManagerViewStore.getState().request).toBe("show"));
    expect(toggle).toHaveBeenCalledTimes(1);
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
  });

  it("ignores the shortcut until the page is back, then works again", async () => {
    let finishNavigation: () => void = () => undefined;
    const returning = returnFromManager(
      { href: "/env/thread", grow: true },
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    useManagerViewStore.setState({ shown: true });
    toggleManager();
    expect(useManagerViewStore.getState().request).toBeNull();

    finishNavigation();
    await returning;
    closeHomeOverlay();
    toggleManager();
    expect(useManagerViewStore.getState().request).toBe("hide");
  });

  it("keeps covering the page change for a moment after the hold is released", async () => {
    await returnFromManager({ href: "/env/thread", grow: true }, () => Promise.resolve());
    expect(homeOverlayHeldOpen()).toBe(true);
  });

  it("lets Grow go again if the page cannot be reached", async () => {
    await returnFromManager({ href: "/gone", grow: true }, () => Promise.reject(new Error("no")));
    expect(growOpen()).toBe(true);
  });

  it("leaves Grow closed when the manager was opened from a page", async () => {
    await returnFromManager({ href: "/env/thread", grow: false }, () => Promise.resolve());
    expect(growOpen()).toBe(false);
  });
});
