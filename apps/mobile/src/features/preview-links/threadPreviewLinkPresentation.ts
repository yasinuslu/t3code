import type { MenuAction } from "@react-native-menu/menu";
import type { ThreadPreviewLink, ThreadPreviewLinkState } from "@t3tools/contracts";

/** Newest first: the most recently linked preview leads the chip. */
export function sortPreviewLinksNewestFirst(
  links: ReadonlyArray<ThreadPreviewLink>,
): ReadonlyArray<ThreadPreviewLink> {
  return [...links].sort((a, b) =>
    a.linkedAt === b.linkedAt ? 0 : a.linkedAt > b.linkedAt ? -1 : 1,
  );
}

export interface PreviewLinkStatePresentation {
  /** Short state text for menus and accessibility; null when unknown. */
  readonly label: string | null;
  /** Dot fill class; null draws no dot. */
  readonly dotClassName: string | null;
  /** The host removed the preview: dim it and refuse to open it. */
  readonly removed: boolean;
}

export function presentPreviewLinkState(
  state: ThreadPreviewLinkState,
): PreviewLinkStatePresentation {
  switch (state) {
    case "running":
      return { label: "Running", dotClassName: "bg-adaptive-emerald-600-400", removed: false };
    case "starting":
      return { label: "Starting", dotClassName: "bg-adaptive-amber-700-400", removed: false };
    case "stopped":
      return {
        label: "Stopped, opening wakes it",
        dotClassName: "bg-foreground-muted",
        removed: false,
      };
    case "failed":
      return { label: "Failed", dotClassName: "bg-adaptive-rose-600-400", removed: false };
    case "gone":
      return { label: "Removed", dotClassName: null, removed: true };
    case "unknown":
      return { label: null, dotClassName: null, removed: false };
  }
}

export interface ThreadPreviewChipPresentation {
  readonly link: ThreadPreviewLink;
  readonly label: string;
  /** "+N" for the links folded behind the newest one. */
  readonly countLabel: string | null;
  readonly state: ThreadPreviewLinkState;
  readonly status: PreviewLinkStatePresentation;
  readonly accessibilityLabel: string;
}

export function presentThreadPreviewChip(
  links: ReadonlyArray<ThreadPreviewLink>,
  states: ReadonlyMap<string, ThreadPreviewLinkState>,
  labelOf: (link: ThreadPreviewLink) => string,
): ThreadPreviewChipPresentation | null {
  const link = sortPreviewLinksNewestFirst(links)[0];
  if (link === undefined) return null;
  const state = states.get(link.url) ?? "unknown";
  const status = presentPreviewLinkState(state);
  const label = labelOf(link);
  const others = links.length - 1;
  return {
    link,
    label,
    countLabel: others > 0 ? `+${others}` : null,
    state,
    status,
    accessibilityLabel: [`Preview ${label}`, status.label, others > 0 ? `${others} more` : null]
      .filter((part) => part !== null)
      .join(", "),
  };
}

export type PreviewLinkMenuIntent = "open" | "open-external" | "copy" | "remove";

const INTENTS: ReadonlyArray<{
  readonly intent: PreviewLinkMenuIntent;
  readonly title: string;
  readonly image: string;
}> = [
  { intent: "open", title: "Open", image: "globe" },
  { intent: "open-external", title: "Open in Browser", image: "safari" },
  { intent: "copy", title: "Copy Link", image: "doc.on.doc" },
  { intent: "remove", title: "Remove", image: "trash" },
];

function linkActions(link: ThreadPreviewLink): MenuAction[] {
  return INTENTS.map(({ intent, title, image }) => ({
    id: `${intent}|${link.url}`,
    title,
    image,
    ...(intent === "remove" ? { attributes: { destructive: true } } : {}),
  }));
}

/** One flat menu for a single link; a submenu per link (newest first) otherwise. */
export function previewLinkMenuActions(
  links: ReadonlyArray<ThreadPreviewLink>,
  states: ReadonlyMap<string, ThreadPreviewLinkState>,
  labelOf: (link: ThreadPreviewLink) => string,
): MenuAction[] {
  const sorted = sortPreviewLinksNewestFirst(links);
  if (sorted.length === 1) return linkActions(sorted[0]!);
  return sorted.map((link) => {
    const status = presentPreviewLinkState(states.get(link.url) ?? "unknown");
    return {
      id: `link|${link.url}`,
      title: labelOf(link),
      ...(status.label !== null ? { subtitle: status.label } : {}),
      image: "globe",
      subactions: linkActions(link),
    };
  });
}

export function parsePreviewLinkMenuEvent(
  event: string,
  links: ReadonlyArray<ThreadPreviewLink>,
): { readonly intent: PreviewLinkMenuIntent; readonly link: ThreadPreviewLink } | null {
  const separator = event.indexOf("|");
  if (separator < 0) return null;
  const intent = INTENTS.find((entry) => entry.intent === event.slice(0, separator))?.intent;
  const url = event.slice(separator + 1);
  const link = links.find((candidate) => candidate.url === url);
  return intent !== undefined && link !== undefined ? { intent, link } : null;
}
