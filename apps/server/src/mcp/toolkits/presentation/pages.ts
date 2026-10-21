import type { OrchestratorMcpFailure, PresentationPage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { linkStoredImages, localImagePaths } from "../threadStatus/reportImages.ts";
import { invalid } from "../threadStatus/storeFile.ts";
import type { PresentationToolkit } from "./tools.ts";

type PageInput =
  (typeof PresentationToolkit.tools.presentation_set.parametersSchema.Type)["pages"][number];

const MAX_IMAGES = 24;
const IMAGE_PATH = /^\/.+\.(png|jpe?g|gif|webp)$/i;
const ATTACHMENT = /^attachment:([\w-]+)$/;

/** How pages reach storage; the handler copies files into T3, tests record them. */
export interface PageStore<R> {
  readonly image: (path: string) => Effect.Effect<string, OrchestratorMcpFailure, R>;
  readonly html: (
    source: { readonly html: string } | { readonly path: string },
  ) => Effect.Effect<string, OrchestratorMcpFailure, R>;
}

/**
 * Turns what an agent passed to `presentation_set` into stored pages: images and HTML go to
 * storage and are referenced by attachment id, a doc's images become `attachment:` links.
 */
export const storePresentationPages = Effect.fn("storePresentationPages")(function* <R>(
  input: ReadonlyArray<PageInput>,
  store: PageStore<R>,
) {
  let images = 0;
  const storeImage = (path: string) => {
    images += 1;
    return images > MAX_IMAGES
      ? Effect.fail(invalid(`A presentation can carry at most ${MAX_IMAGES} images.`))
      : store.image(path);
  };
  const pages: PresentationPage[] = [];
  for (const [index, page] of input.entries()) {
    const title = page.title?.trim() ? { title: page.title.trim() } : {};
    switch (page.kind) {
      case "image": {
        const source = page.image.trim();
        const kept = ATTACHMENT.exec(source)?.[1];
        if (kept === undefined && !IMAGE_PATH.test(source)) {
          return yield* invalid(
            `Page ${index + 1}: image must be an absolute path to a png, jpg, gif or webp, or attachment:<id>.`,
          );
        }
        pages.push({
          kind: "image",
          ...title,
          image: kept ?? (yield* storeImage(source)),
          ...(page.marks && page.marks.length > 0 ? { marks: page.marks } : {}),
        });
        break;
      }
      case "doc": {
        const stored = new Map<string, string>();
        for (const path of localImagePaths(page.markdown)) {
          stored.set(path, yield* storeImage(path));
        }
        pages.push({ kind: "doc", ...title, markdown: linkStoredImages(page.markdown, stored) });
        break;
      }
      case "html": {
        const { html, path } = page;
        if ((html === undefined) === (path === undefined)) {
          return yield* invalid(`Page ${index + 1}: give html or path, one of them.`);
        }
        const file = yield* store.html(path === undefined ? { html: html ?? "" } : { path });
        pages.push({ kind: "html", ...title, file });
        break;
      }
    }
  }
  return pages;
});
