import type {
  PreviewSessionSnapshot,
  ThreadPreviewLink,
  ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { normalizePreviewLinkUrl } from "@t3tools/shared/threadPreviewLinks";

/** The newest link leads a thread row; the rest fold into a "+N". */
export function latestPreviewLink(links: ReadonlyArray<ThreadPreviewLink> | undefined): {
  readonly link: ThreadPreviewLink;
  readonly others: number;
} | null {
  if (!links || links.length === 0) return null;
  let latest = links[0]!;
  for (const link of links) {
    if (link.linkedAt > latest.linkedAt) latest = link;
  }
  return { link: latest, others: links.length - 1 };
}

export interface PreviewLinkStatePresentation {
  /** Tooltip text for the state; null when the state is unknown. */
  readonly label: string | null;
  readonly dot: "running" | "starting" | "stopped" | "failed" | null;
  /** The host removed the preview: the chip dims and opening is refused. */
  readonly removed: boolean;
}

export function previewLinkStatePresentation(
  state: ThreadPreviewLinkState,
): PreviewLinkStatePresentation {
  switch (state) {
    case "running":
      return { label: "Running", dot: "running", removed: false };
    case "starting":
      return { label: "Starting", dot: "starting", removed: false };
    case "stopped":
      return { label: "Stopped: opening wakes it", dot: "stopped", removed: false };
    case "failed":
      return { label: "Failed", dot: "failed", removed: false };
    case "gone":
      return { label: "Preview removed", dot: null, removed: true };
    case "unknown":
      return { label: null, dot: null, removed: false };
  }
}

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const sessionUrl = (session: PreviewSessionSnapshot): string | null =>
  session.navStatus._tag === "Idle" ? null : session.navStatus.url;

/**
 * The thread's browser tab already showing this preview, so a second click focuses it instead
 * of stacking duplicates. An exact URL wins; otherwise any tab on the same origin counts, since
 * the user has usually navigated inside the preview since opening it.
 */
export function findPreviewTabForUrl(
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  url: string,
): string | null {
  const target = parseUrl(url);
  const normalized = normalizePreviewLinkUrl(url) ?? url;
  let sameOrigin: string | null = null;
  for (const [tabId, session] of Object.entries(sessions)) {
    const current = sessionUrl(session);
    if (current === null) continue;
    if ((normalizePreviewLinkUrl(current) ?? current) === normalized) return tabId;
    if (sameOrigin === null && target !== null && parseUrl(current)?.origin === target.origin) {
      sameOrigin = tabId;
    }
  }
  return sameOrigin;
}
