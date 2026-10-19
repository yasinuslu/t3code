import { describe, expect, it } from "vite-plus/test";

import { resolveStackedLayout } from "./useStackedLayout";

describe("resolveStackedLayout", () => {
  it("auto stacks only on a tall window wider than a phone", () => {
    expect(resolveStackedLayout("auto", true, true)).toBe(true);
    expect(resolveStackedLayout("auto", false, true)).toBe(false);
  });

  it("forced modes ignore the window shape, but phones keep their own layout", () => {
    expect(resolveStackedLayout("landscape", true, true)).toBe(false);
    expect(resolveStackedLayout("portrait", false, true)).toBe(true);
    expect(resolveStackedLayout("portrait", false, false)).toBe(false);
  });
});
