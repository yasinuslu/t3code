import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { useMouseHistoryButtons, useMouseThumbButtons } from "./mouseThumbButtons";

describe("mouse thumb buttons", () => {
  const onStep = vi.fn();

  function mountRegions() {
    const inside = document.createElement("section");
    inside.setAttribute("data-region", "");
    inside.append(document.createElement("button"));
    const outside = document.createElement("main");
    document.body.append(inside, outside);
    onStep.mockReset();
    return {
      inside,
      outside,
      [Symbol.dispose]() {
        inside.remove();
        outside.remove();
      },
    };
  }

  const press = (target: Element, type: string, button: number) => {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  function ThumbConsumer() {
    useMouseThumbButtons("[data-region]", onStep);
    return null;
  }

  function HistoryConsumer() {
    useMouseHistoryButtons("[data-region]", onStep);
    return null;
  }

  it("steps back and forward on mouseup inside the region, and swallows the whole press", async () => {
    using regions = mountRegions();
    const { inside } = regions;
    await using _screen = await render(<ThumbConsumer />, { router: false });
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
    using regions = mountRegions();
    const { inside, outside } = regions;
    await using _screen = await render(<ThumbConsumer />, { router: false });
    expect(press(outside, "mouseup", 3).defaultPrevented).toBe(false);
    expect(press(inside, "mouseup", 0).defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("history hook steps outside the claimed region only", async () => {
    using regions = mountRegions();
    const { inside, outside } = regions;
    await using _screen = await render(<HistoryConsumer />, { router: false });
    expect(press(outside, "mousedown", 3).defaultPrevented).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
    press(outside, "mouseup", 3);
    expect(onStep).toHaveBeenLastCalledWith(-1);
    press(outside, "mouseup", 4);
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(press(inside, "mouseup", 3).defaultPrevented).toBe(false);
    expect(onStep).toHaveBeenCalledTimes(2);
  });
});
