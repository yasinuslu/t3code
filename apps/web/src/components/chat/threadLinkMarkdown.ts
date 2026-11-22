import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";

// A bare link stops at whitespace, brackets and trailing sentence punctuation.
const BARE_THREAD_LINK_PATTERN =
  /(?:t3code:\/\/threads|t3:\/\/thread)\/[^\s/()<>[\]]+\/[^\s/()<>[\]]*[^\s/()<>[\].,;:!?'"]/giu;

/** Bare thread links in prose, which the chat links so they render as thread chips. */
export function bareThreadLinkMatches(
  text: string,
): Array<{ readonly index: number; readonly href: string }> {
  if (!text.includes("t3")) return [];
  const found: Array<{ index: number; href: string }> = [];
  for (const match of text.matchAll(BARE_THREAD_LINK_PATTERN)) {
    if (parseThreadLinkHref(match[0]) !== null) found.push({ index: match.index, href: match[0] });
  }
  return found;
}
