import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { storePresentationPages, withGrowKeys } from "./pages.ts";

const recorder = () => {
  const stored: string[] = [];
  return {
    stored,
    store: {
      image: (path: string) => Effect.sync(() => (stored.push(path), `img-${stored.length}`)),
      html: (source: { readonly html: string } | { readonly path: string }) =>
        Effect.sync(() => (stored.push("html" in source ? "inline" : source.path), "page-html")),
    },
  };
};

describe("storePresentationPages", () => {
  it.effect("stores files and keeps pages in order, by attachment id", () =>
    Effect.gen(function* () {
      const { stored, store } = recorder();
      const pages = yield* storePresentationPages(
        [
          {
            kind: "image",
            title: " After ",
            image: "/tmp/after.png",
            marks: [{ x: 10, y: 20, width: 30, height: 5, label: "New row" }],
          },
          { kind: "doc", markdown: "# Why\n\n![before](/tmp/before.png)" },
          { kind: "html", html: "<h1>Try it</h1>" },
          { kind: "image", image: "attachment:kept-1" },
        ],
        store,
      );
      expect(stored).toEqual(["/tmp/after.png", "/tmp/before.png", "inline"]);
      expect(pages).toEqual([
        {
          kind: "image",
          title: "After",
          image: "img-1",
          marks: [{ x: 10, y: 20, width: 30, height: 5, label: "New row" }],
        },
        { kind: "doc", markdown: "# Why\n\n![before](attachment:img-2)" },
        { kind: "html", file: "page-html" },
        { kind: "image", image: "kept-1" },
      ]);
    }),
  );

  it.effect("rejects an image that is neither a local image path nor a stored one", () =>
    Effect.gen(function* () {
      const failure = yield* storePresentationPages(
        [{ kind: "image", image: "https://example.com/shot.png" }],
        recorder().store,
      ).pipe(Effect.flip);
      expect(failure.code).toBe("invalid_request");
    }),
  );

  it.effect("needs exactly one of html and path for an html page", () =>
    Effect.gen(function* () {
      const { store } = recorder();
      for (const page of [{}, { html: "<p>x</p>", path: "/tmp/x.html" }]) {
        const failure = yield* storePresentationPages([{ kind: "html", ...page }], store).pipe(
          Effect.flip,
        );
        expect(failure.code).toBe("invalid_request");
      }
    }),
  );
});

describe("withGrowKeys", () => {
  it("puts the key script after the doctype, so the page keeps standards mode", () => {
    const page = withGrowKeys("<!DOCTYPE html><html><body>x</body></html>");
    expect(page.startsWith("<!DOCTYPE html><script>")).toBe(true);
    expect(page.endsWith("<html><body>x</body></html>")).toBe(true);
  });

  it("puts it first in a page without a doctype", () => {
    expect(withGrowKeys("<p>x</p>")).toMatch(/^<script>.*t3-grow-key.*<\/script><p>x<\/p>$/);
  });
});
