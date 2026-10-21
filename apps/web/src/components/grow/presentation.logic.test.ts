import type { ThreadPresentation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSlides, formAnswerText } from "./presentation.logic";

const pages: ThreadPresentation["pages"] = [
  {
    kind: "image",
    title: "After",
    image: "img-1",
    marks: [{ x: 1, y: 2, width: 3, height: 4, label: "New" }],
  },
  {
    kind: "doc",
    markdown: "## Why it changed\n\n![before](attachment:img-2)\n\n![after](attachment:img-3)",
  },
  { kind: "html", file: "page-html" },
];

describe("buildSlides", () => {
  it("turns each page into a slide, with its files at their URLs", () => {
    const slides = buildSlides(pages, ["u1", "u2", "u3", "u4"], []);
    expect(slides).toEqual([
      {
        kind: "image",
        key: "page:0",
        name: "After",
        src: "u1",
        marks: [{ x: 1, y: 2, width: 3, height: 4, label: "New" }],
      },
      {
        kind: "doc",
        key: "page:1",
        name: "Why it changed",
        markdown: "## Why it changed\n\n![before](u2)\n\n![after](u3)",
      },
      { kind: "html", key: "page:2", name: "Interactive page", src: "u4" },
    ]);
  });

  it("leaves out a file page until its URL arrives, and keeps the doc meanwhile", () => {
    const slides = buildSlides(pages, [null, null, "u3", null], []);
    expect(slides.map((slide) => slide.kind)).toEqual(["doc"]);
    expect(slides[0]).toMatchObject({
      markdown: "## Why it changed\n\n![before](attachment:img-2)\n\n![after](u3)",
    });
  });

  it("shows the status report's images when there is no presentation", () => {
    const slides = buildSlides(
      undefined,
      [],
      [
        { src: "shot.png", name: "Result" },
        { src: "", name: "Still loading" },
      ],
    );
    expect(slides).toEqual([
      { kind: "image", key: "report:0", name: "Result", src: "shot.png", marks: [] },
    ]);
  });
});

describe("form pages", () => {
  const fields = [
    { id: "color", label: "Which color?", options: ["Blue", "Green"] },
    { id: "why", label: "Anything else?" },
  ];

  it("names a form by its presentation, so a new one asks anew", () => {
    const form = (at: string) =>
      buildSlides([{ kind: "form", fields }], [], [], at)[0] as { readonly requestId: string };
    const first = form("2026-10-21T10:00:00.000Z").requestId;
    expect(first).toBe(form("2026-10-21T10:00:00.000Z").requestId);
    expect(first).not.toBe(form("2026-10-21T11:00:00.000Z").requestId);
  });

  it("sends one question and answer per line", () => {
    expect(formAnswerText([{ id: "n", label: "Name" }], { n: "Ada" })).toBe("Name: Ada");
    expect(formAnswerText(fields, { color: "Blue", why: " no " })).toBe(
      "Which color? Blue\nAnything else? no",
    );
  });
});
