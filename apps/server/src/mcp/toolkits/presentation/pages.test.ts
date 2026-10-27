import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { storePresentationPages } from "./pages.ts";

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

  it.effect("keeps a form's questions trimmed, and refuses repeated ids or a lone option", () =>
    Effect.gen(function* () {
      const { store } = recorder();
      const pages = yield* storePresentationPages(
        [
          {
            kind: "form",
            fields: [
              { id: " color ", label: "Which color?", options: [" Blue", "Green ", " "] },
              { id: "why", label: "Anything else?", options: [] },
            ],
          },
        ],
        store,
      );
      expect(pages).toEqual([
        {
          kind: "form",
          fields: [
            { id: "color", label: "Which color?", options: ["Blue", "Green"] },
            { id: "why", label: "Anything else?" },
          ],
        },
      ]);
      for (const fields of [
        [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
        [{ id: "a", label: "A", options: ["Only"] }],
      ]) {
        const failure = yield* storePresentationPages([{ kind: "form", fields }], store).pipe(
          Effect.flip,
        );
        expect(failure.code).toBe("invalid_request");
      }
    }),
  );
});
