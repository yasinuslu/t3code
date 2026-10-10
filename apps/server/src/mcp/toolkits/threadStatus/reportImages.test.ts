import { describe, expect, it } from "vitest";

import { linkStoredImages, localImagePaths } from "./reportImages.ts";

describe("status report images", () => {
  const report = [
    "The band holds its instruments.",
    "",
    "![Stage, before and after](/tmp/shots/stage.png)",
    "[garage](</work/art/garage%20night.webp>) and [notes](/work/notes.md)",
    "![again](/tmp/shots/stage.png) ![remote](https://example.org/a.png)",
  ].join("\n");

  it("finds local images only, once each", () => {
    expect(localImagePaths(report)).toEqual([
      "/tmp/shots/stage.png",
      "/work/art/garage night.webp",
    ]);
  });

  it("points stored images at their attachments and leaves the rest", () => {
    const linked = linkStoredImages(
      report,
      new Map([
        ["/tmp/shots/stage.png", "t-1"],
        ["/work/art/garage night.webp", "t-2"],
      ]),
    );
    expect(linked).toContain("![Stage, before and after](attachment:t-1)");
    expect(linked).toContain("[garage](attachment:t-2)");
    expect(linked).toContain("![again](attachment:t-1)");
    expect(linked).toContain("[notes](/work/notes.md)");
    expect(linked).toContain("![remote](https://example.org/a.png)");
  });
});
