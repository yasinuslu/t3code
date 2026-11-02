import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useManagerViewStore } from "../managerViewStore";
import { returnFromManager, toggleManager } from "./goToManager";

afterEach(() => {
  vi.unstubAllGlobals();
  useManagerViewStore.setState({ shown: false, request: null, returnTo: null });
});

describe("the manager shortcut", () => {
  it("asks for the manager when it is not showing", async () => {
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    toggleManager();
    await vi.waitFor(() => expect(useManagerViewStore.getState().request).toBe("show"));
  });

  it("hides the manager when it shows", () => {
    useManagerViewStore.setState({ shown: true });
    toggleManager();
    expect(useManagerViewStore.getState().request).toBe("hide");
  });
});

describe("going back from the manager", () => {
  it("goes to the page it was opened from, or home", async () => {
    const navigate = vi.fn(() => Promise.resolve());
    await returnFromManager({ href: "/env/thread" }, navigate);
    await returnFromManager(null, navigate);
    expect(navigate.mock.calls).toEqual([["/env/thread"], ["/"]]);
  });

  it("stays put when the page cannot be reached", async () => {
    await expect(
      returnFromManager({ href: "/gone" }, () => Promise.reject(new Error("no"))),
    ).resolves.toBeUndefined();
  });
});
