import type { PresentationMark, ThreadPresentation } from "@t3tools/contracts";

import type { ExpandedImageItem } from "../chat/ExpandedImagePreview";

/** One page of what Grow shows for an item, ready to render. */
export type Slide =
  | {
      readonly kind: "image";
      readonly key: string;
      readonly name: string;
      readonly src: string;
      readonly marks: ReadonlyArray<PresentationMark>;
    }
  | { readonly kind: "doc"; readonly key: string; readonly name: string; readonly markdown: string }
  | { readonly kind: "html"; readonly key: string; readonly name: string; readonly src: string };

/** A markdown link or image whose target is a stored file. */
export const ATTACHMENT_LINK = /\]\(<?attachment:([\w-]+)>?\)/g;

/**
 * Pages to slides, given the URLs of the files they point at in the order `useSlides` asks for
 * them (null while loading). A page whose file has no URL yet is left out until it has one.
 */
export function buildSlides(
  pages: ThreadPresentation["pages"] | undefined,
  urls: ReadonlyArray<string | null>,
  reportImages: ReadonlyArray<ExpandedImageItem>,
): ReadonlyArray<Slide> {
  if (pages === undefined) {
    return reportImages.flatMap((image, index): Slide[] =>
      image.src
        ? [{ kind: "image", key: `report:${index}`, name: image.name, src: image.src, marks: [] }]
        : [],
    );
  }
  let at = 0;
  const next = () => urls[at++] ?? null;
  return pages.flatMap((page, index): Slide[] => {
    const key = `page:${index}`;
    switch (page.kind) {
      case "image": {
        const src = next();
        const name = page.title ?? `Page ${index + 1}`;
        return src ? [{ kind: "image", key, name, src, marks: page.marks ?? [] }] : [];
      }
      case "html": {
        const src = next();
        return src ? [{ kind: "html", key, name: page.title ?? "Interactive page", src }] : [];
      }
      case "doc": {
        // Images stored for the page show through their asset URLs; one still loading
        // stays a plain link until it resolves.
        const markdown = page.markdown.replace(ATTACHMENT_LINK, (whole) => {
          const url = next();
          return url ? `](${url})` : whole;
        });
        return [{ kind: "doc", key, name: page.title ?? docTitle(page.markdown), markdown }];
      }
    }
  });
}

function docTitle(markdown: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : "Page";
}
