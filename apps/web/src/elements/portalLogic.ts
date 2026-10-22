/**
 * Pure logic for the `t3-portal` host capability (see the t3-elements README, "Host capabilities"):
 * what a component may ask for, and how the overlay's keys move through a gallery.
 */

export interface PortalImage {
  readonly src: string;
  readonly caption?: string | undefined;
  readonly alt?: string | undefined;
}

export type PortalRequest =
  | { readonly kind: "image"; readonly images: ReadonlyArray<PortalImage>; readonly index: number }
  | {
      readonly kind: "element";
      readonly tag: string;
      readonly props: Record<string, unknown>;
      readonly title?: string | undefined;
    };

const MAX_IMAGES = 48;
// Images cannot run script, but keep javascript: and friends out anyway.
const SAFE_SRC = /^(https?:|data:image\/|blob:|\/(?!\/))/i;

/** Moves an index by delta, wrapping at both ends. An empty list gives 0. */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** Validates what an element put in a `t3-portal` event; null means ignore it. */
export function parsePortalRequest(
  detail: unknown,
  isDefined: (tag: string) => boolean,
): PortalRequest | null {
  if (detail === null || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.kind === "image") {
    if (!Array.isArray(d.images)) return null;
    const images: PortalImage[] = [];
    for (const raw of d.images.slice(0, MAX_IMAGES)) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.src !== "string" || !SAFE_SRC.test(r.src.trim())) continue;
      images.push({
        src: r.src.trim(),
        caption: typeof r.caption === "string" && r.caption !== "" ? r.caption : undefined,
        alt: typeof r.alt === "string" && r.alt !== "" ? r.alt : undefined,
      });
    }
    if (images.length === 0) return null;
    const index = typeof d.index === "number" && Number.isFinite(d.index) ? Math.trunc(d.index) : 0;
    return { kind: "image", images, index: stepIndex(index, 0, images.length) };
  }
  if (d.kind === "element") {
    if (typeof d.tag !== "string" || !/^t3-[a-z0-9-]+$/.test(d.tag) || !isDefined(d.tag)) {
      return null;
    }
    if (d.props === null || typeof d.props !== "object" || Array.isArray(d.props)) return null;
    return {
      kind: "element",
      tag: d.tag,
      props: d.props as Record<string, unknown>,
      title: typeof d.title === "string" && d.title !== "" ? d.title.slice(0, 200) : undefined,
    };
  }
  return null;
}

export type PortalKeyAction =
  | { readonly type: "close" }
  | { readonly type: "step"; readonly delta: 1 | -1 };

/** What a key does in the overlay. Arrows only step through more than one image. */
export function portalKeyAction(key: string, imageCount: number): PortalKeyAction | null {
  if (key === "Escape") return { type: "close" };
  if (imageCount > 1 && key === "ArrowRight") return { type: "step", delta: 1 };
  if (imageCount > 1 && key === "ArrowLeft") return { type: "step", delta: -1 };
  return null;
}

/** A horizontal swipe long enough, and flatter than it is wide, steps like an arrow key. */
export function swipeDelta(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
