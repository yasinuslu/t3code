import { describe, expect, it } from "vite-plus/test";

import { adjacentPane, paneOrder } from "./paneOrder";

const pane = (name: string, left: number, top = 0) => ({ name, left, top });

describe("paneOrder", () => {
  it("sorts by screen position, left edge first", () => {
    const sidebar = pane("sidebar", 0);
    const chat = pane("chat", 260);
    const panel = pane("panel", 900);
    expect(paneOrder([panel, sidebar, chat]).map((p) => p.name)).toEqual([
      "sidebar",
      "chat",
      "panel",
    ]);
  });

  it("puts the upper pane first when two share a left edge, and ignores sub-pixel noise", () => {
    const lower = pane("lower", 400.3, 300);
    const upper = pane("upper", 399.8, 0);
    expect(paneOrder([lower, upper]).map((p) => p.name)).toEqual(["upper", "lower"]);
  });
});

describe("adjacentPane", () => {
  const ordered = [pane("a", 0), pane("b", 100), pane("c", 200)];
  const [a, b, c] = ordered as [(typeof ordered)[0], (typeof ordered)[0], (typeof ordered)[0]];

  it("steps one pane left or right and stops at the edges", () => {
    expect(adjacentPane(ordered, b, 1)).toBe(c);
    expect(adjacentPane(ordered, b, -1)).toBe(a);
    expect(adjacentPane(ordered, c, 1)).toBeNull();
    expect(adjacentPane(ordered, a, -1)).toBeNull();
  });

  it("enters from the near end when focus is in no pane", () => {
    expect(adjacentPane(ordered, null, 1)).toBe(a);
    expect(adjacentPane(ordered, null, -1)).toBe(c);
    expect(adjacentPane([], null, 1)).toBeNull();
  });
});
