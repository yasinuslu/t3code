import { describe, expect, it } from "vite-plus/test";

import { parsePortalRequest, portalKeyAction, stepIndex, swipeDelta } from "./portalLogic";

const defined = (tag: string) => tag === "t3-flow";

describe("stepIndex", () => {
  it("wraps both ways and survives an empty list", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(7, 0, 3)).toBe(1);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("parsePortalRequest", () => {
  it("keeps safe images, clamps the index, drops unsafe sources", () => {
    const request = parsePortalRequest(
      {
        kind: "image",
        images: [
          { src: "https://a.test/1.png", caption: "One" },
          { src: "javascript:alert(1)" },
          { src: "data:image/png;base64,AAAA" },
          { nope: true },
        ],
        index: 9,
      },
      defined,
    );
    expect(request).toMatchObject({ kind: "image", index: 1 });
    expect(request?.kind === "image" && request.images.map((i) => i.src)).toEqual([
      "https://a.test/1.png",
      "data:image/png;base64,AAAA",
    ]);
  });

  it("needs at least one usable image", () => {
    expect(
      parsePortalRequest({ kind: "image", images: [{ src: "ftp://x" }], index: 0 }, defined),
    ).toBeNull();
    expect(parsePortalRequest({ kind: "image", index: 0 }, defined)).toBeNull();
  });

  it("accepts only defined t3- elements with object props", () => {
    const ok = parsePortalRequest(
      { kind: "element", tag: "t3-flow", props: { a: 1 }, title: "T" },
      defined,
    );
    expect(ok).toEqual({ kind: "element", tag: "t3-flow", props: { a: 1 }, title: "T" });
    expect(parsePortalRequest({ kind: "element", tag: "div", props: {} }, defined)).toBeNull();
    expect(parsePortalRequest({ kind: "element", tag: "t3-plot", props: {} }, defined)).toBeNull();
    expect(parsePortalRequest({ kind: "element", tag: "t3-flow", props: [] }, defined)).toBeNull();
    expect(parsePortalRequest("x", defined)).toBeNull();
  });
});

describe("portalKeyAction", () => {
  it("closes on Escape and steps only with several images", () => {
    expect(portalKeyAction("Escape", 1)).toEqual({ type: "close" });
    expect(portalKeyAction("ArrowRight", 3)).toEqual({ type: "step", delta: 1 });
    expect(portalKeyAction("ArrowLeft", 3)).toEqual({ type: "step", delta: -1 });
    expect(portalKeyAction("ArrowRight", 1)).toBeNull();
    expect(portalKeyAction("a", 3)).toBeNull();
  });
});

describe("swipeDelta", () => {
  it("needs a long, mostly horizontal move", () => {
    expect(swipeDelta(-80, 10)).toBe(1);
    expect(swipeDelta(80, 10)).toBe(-1);
    expect(swipeDelta(20, 0)).toBe(0);
    expect(swipeDelta(60, 60)).toBe(0);
  });
});
