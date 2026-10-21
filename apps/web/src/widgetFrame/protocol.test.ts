import { describe, expect, it } from "vite-plus/test";

import { attachmentRefs } from "./protocol";

describe("attachmentRefs", () => {
  it("finds attachment refs at any depth, once each, and nothing else", () => {
    expect(
      attachmentRefs([
        { widget: "Shot", props: { image: "attachment:a1", caption: "see attachment:a2" } },
        {
          widget: "Compare",
          props: { before: { image: "attachment:a1" }, after: [{ image: "attachment:b-2" }] },
        },
        { widget: "Shot", props: { image: "example:desktop" } },
      ]),
    ).toEqual(["a1", "b-2"]);
  });
});
