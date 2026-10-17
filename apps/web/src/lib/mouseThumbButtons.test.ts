// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useMouseThumbButtons } from "./mouseThumbButtons";

describe("useMouseThumbButtons", () => {
  let root: Root;
  let container: HTMLDivElement;
  let inside: HTMLElement;
  let outside: HTMLElement;
  const onStep = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onStep.mockReset();
    container = document.createElement("div");
    inside = document.createElement("section");
    inside.setAttribute("data-region", "");
    const child = document.createElement("button");
    inside.append(child);
    outside = document.createElement("main");
    document.body.append(container, inside, outside);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    inside.remove();
    outside.remove();
    vi.unstubAllGlobals();
  });

  const mountHook = async () => {
    function Consumer() {
      useMouseThumbButtons("[data-region]", onStep);
      return null;
    }
    await act(async () => root.render(createElement(Consumer)));
  };
  const press = (target: Element, type: string, button: number) => {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it("steps back and forward on mouseup inside the region, and swallows the whole press", async () => {
    await mountHook();
    const target = inside.firstElementChild!;
    for (const type of ["mousedown", "auxclick"]) {
      expect(press(target, type, 3).defaultPrevented).toBe(true);
    }
    expect(onStep).not.toHaveBeenCalled();
    expect(press(target, "mouseup", 3).defaultPrevented).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(-1);
    press(target, "mouseup", 4);
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("leaves the buttons alone outside the region and for other buttons", async () => {
    await mountHook();
    expect(press(outside, "mouseup", 3).defaultPrevented).toBe(false);
    expect(press(inside, "mouseup", 0).defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });
});
