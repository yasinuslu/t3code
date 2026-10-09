import type { ThreadPreviewLink } from "@t3tools/contracts";

/** A thread keeps only its newest preview links. */
export const MAX_THREAD_PREVIEW_LINKS = 10;

/**
 * The stored form of a preview URL, or null when it is not http(s). Hosts are lowercased by
 * URL parsing, and a bare origin drops its trailing slash so `http://a.test/` and
 * `http://a.test` are the same link.
 */
export function normalizePreviewLinkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const href = url.href;
  return url.pathname === "/" && url.search === "" && url.hash === "" && href.endsWith("/")
    ? href.slice(0, -1)
    : href;
}

/** The origin a preview answers its status on, or null when the URL is not http(s). */
export function previewLinkOrigin(raw: string): string | null {
  const normalized = normalizePreviewLinkUrl(raw);
  return normalized === null ? null : new URL(normalized).origin;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/giu;

/**
 * The first http(s) URL per origin in `text`, in order of appearance, at most `maxOrigins`.
 * Trailing sentence punctuation is not part of the URL.
 */
export function extractPreviewLinkCandidates(
  text: string,
  maxOrigins: number,
): ReadonlyArray<string> {
  const byOrigin = new Map<string, string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    if (byOrigin.size >= maxOrigins) break;
    const url = normalizePreviewLinkUrl(match[0].replace(/[.,;:!?*_~]+$/u, ""));
    if (url === null) continue;
    const origin = new URL(url).origin;
    if (!byOrigin.has(origin)) byOrigin.set(origin, url);
  }
  return [...byOrigin.values()];
}

/**
 * What a preview is called in the UI: its label, else the host's first DNS label
 * (`t3code-my-branch` for `t3code-my-branch.pv.example.org`). Single-label hosts and IP
 * addresses keep their port so `localhost:3000` and `localhost:5173` stay distinct.
 */
export function previewLinkLabel(link: Pick<ThreadPreviewLink, "url" | "label">): string {
  if (link.label !== undefined) return link.label;
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return link.url;
  }
  const hostname = url.hostname;
  const isIp = hostname.startsWith("[") || /^\d+(?:\.\d+){3}$/u.test(hostname);
  if (isIp || !hostname.includes(".")) return url.host;
  return hostname.split(".")[0] ?? url.host;
}
