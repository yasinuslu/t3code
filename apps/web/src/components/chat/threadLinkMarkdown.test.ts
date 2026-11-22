import { describe, expect, it } from "vite-plus/test";

import { bareThreadLinkMatches } from "./threadLinkMarkdown";

describe("bareThreadLinkMatches", () => {
  it("finds bare thread links and leaves trailing punctuation out", () => {
    expect(
      bareThreadLinkMatches(
        "See t3://thread/env-1/mcp:c1097b24. And t3code://threads/env-1/t-2, too",
      ),
    ).toEqual([
      { index: 4, href: "t3://thread/env-1/mcp:c1097b24" },
      { index: 40, href: "t3code://threads/env-1/t-2" },
    ]);
  });

  it("ignores look-alikes", () => {
    expect(bareThreadLinkMatches("t3://thread/env-1 only")).toEqual([]);
  });
});
