import { describe, expect, it } from "vite-plus/test";

import type { MarkdownNode } from "~/vendor/mdast-find-and-replace";
import { remarkThreadLinks, threadLinkLabel } from "./threadLinkMarkdown";

function linkify(children: MarkdownNode[]): MarkdownNode[] {
  const tree: MarkdownNode = { type: "root", children: [{ type: "paragraph", children }] };
  remarkThreadLinks()(tree);
  return tree.children![0]!.children!;
}

describe("remarkThreadLinks", () => {
  it("links bare thread links and leaves trailing punctuation as text", () => {
    expect(
      linkify([
        {
          type: "text",
          value: "See t3://thread/env-1/mcp:c1097b24. And t3code://threads/env-1/t-2, too",
        },
      ]),
    ).toEqual([
      { type: "text", value: "See " },
      {
        type: "link",
        url: "t3://thread/env-1/mcp:c1097b24",
        children: [{ type: "text", value: "t3://thread/env-1/mcp:c1097b24" }],
      },
      { type: "text", value: ". And " },
      {
        type: "link",
        url: "t3code://threads/env-1/t-2",
        children: [{ type: "text", value: "t3code://threads/env-1/t-2" }],
      },
      { type: "text", value: ", too" },
    ]);
  });

  it("leaves authored links, code and look-alikes alone", () => {
    const authored: MarkdownNode = {
      type: "link",
      url: "t3code://threads/env-1/t-1",
      children: [{ type: "text", value: "t3code://threads/env-1/t-1" }],
    };
    const code: MarkdownNode = { type: "inlineCode", value: "t3://thread/env-1/t-1" };
    const lookAlike: MarkdownNode = { type: "text", value: "t3://thread/env-1 only" };
    expect(linkify([authored, code, lookAlike])).toEqual([authored, code, lookAlike]);
  });
});

describe("threadLinkLabel", () => {
  it("uses the link text unless it is the bare link", () => {
    expect(threadLinkLabel(" Fix parser ", "t3://thread/e/t")).toBe("Fix parser");
    expect(threadLinkLabel("t3://thread/e/t", "t3://thread/e/t")).toBe("Thread");
  });
});
