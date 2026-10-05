import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";

import { findAndReplaceText, type MarkdownNode } from "~/vendor/mdast-find-and-replace";

// A bare link stops at whitespace, brackets and trailing sentence punctuation.
const BARE_THREAD_LINK_PATTERN =
  /(?:t3code:\/\/threads|t3:\/\/thread)\/[^\s/()<>[\]]+\/[^\s/()<>[\]]*[^\s/()<>[\].,;:!?'"]/giu;
const IGNORED_TYPES = new Set(["link", "linkReference"]);

/** Turns bare thread links in prose into links so they render as thread chips. */
export function remarkThreadLinks() {
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      BARE_THREAD_LINK_PATTERN,
      (matched) =>
        parseThreadLinkHref(matched) === null
          ? false
          : { type: "link", url: matched, children: [{ type: "text", value: matched }] },
      IGNORED_TYPES,
    );
  };
}

/** The chip label for a thread link: its text, unless that is just the link itself. */
export function threadLinkLabel(text: string, href: string): string {
  const label = text.trim();
  return label && label !== href ? label : "Thread";
}
