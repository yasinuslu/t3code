import { EnvironmentId, ThreadId } from "@t3tools/contracts";

export interface ThreadLinkTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const THREAD_LINK_PREFIX = "t3code://threads/";
// `t3code://threads/...` is the app's deep link (mobile routes it natively). The short
// `t3://thread/...` form is what agents were first told to write, so it stays readable.
const THREAD_LINK_PATTERN = /^(?:t3code:\/\/threads|t3:\/\/thread)\/([^/?#\s]+)\/([^/?#\s]+)\/?$/iu;

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function decodePathPart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/** Origin-independent link to a thread, so every client and machine reads it the same way. */
export function formatThreadLinkHref(target: ThreadLinkTarget): string {
  return `${THREAD_LINK_PREFIX}${encodePathPart(target.environmentId)}/${encodePathPart(target.threadId)}`;
}

/** The markdown agents paste into chat; T3 renders it as a clickable thread chip. */
export function formatThreadMarkdownLink(target: ThreadLinkTarget & { readonly title: string }) {
  const title = target.title.replace(/\s+/g, " ").trim() || "Thread";
  return `[${title.replace(/[\\[\]]/g, "\\$&")}](${formatThreadLinkHref(target)})`;
}

export function parseThreadLinkHref(href: string): ThreadLinkTarget | null {
  const match = THREAD_LINK_PATTERN.exec(href.trim());
  if (!match) return null;
  const environmentId = decodePathPart(match[1]!);
  const threadId = decodePathPart(match[2]!);
  if (environmentId === null || threadId === null) return null;
  return {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(threadId),
  };
}
