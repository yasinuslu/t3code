import type { PresentationPage } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { applyPresentationEdit, nextPresentation, withPageIds } from "./presentationVersions.ts";

const doc = (markdown: string, id?: string): PresentationPage => ({
  kind: "doc",
  ...(id === undefined ? {} : { id }),
  markdown,
});

describe("nextPresentation", () => {
  it("amends one version within a run and starts the next one with a new run", () => {
    const first = nextPresentation(
      undefined,
      { pages: [doc("# Plan", "plan")], run: "run-1", snapshot: undefined },
      "2026-10-21T10:00:00.000Z",
    );
    const amended = nextPresentation(
      first,
      { pages: [doc("# Plan", "plan"), doc("# Shot")], run: "run-1", snapshot: undefined },
      "2026-10-21T10:01:00.000Z",
    );
    expect(amended?.versions).toEqual([
      { version: 1, run: "run-1", startedAt: "2026-10-21T10:00:00.000Z" },
    ]);
    expect(amended?.pages.map((page) => [page.id, page.revision])).toEqual([
      ["plan", 1],
      ["page-1", 1],
    ]);

    const next = nextPresentation(
      amended,
      { pages: [doc("# Plan v2", "plan"), doc("# Shot")], run: "run-2", snapshot: "snap-1" },
      "2026-10-21T11:00:00.000Z",
    );
    expect(next?.versions).toEqual([
      { version: 1, run: "run-1", startedAt: "2026-10-21T10:00:00.000Z", snapshot: "snap-1" },
      { version: 2, run: "run-2", startedAt: "2026-10-21T11:00:00.000Z" },
    ]);
    // Only the page that changed carries the new version; the unchanged one keeps its place's id.
    expect(next?.pages.map((page) => [page.id, page.revision])).toEqual([
      ["plan", 2],
      ["page-1", 1],
    ]);
  });

  it("treats a presentation from before versions as version 1", () => {
    const next = nextPresentation(
      { pages: [doc("# Old")], updatedAt: "2026-10-20T10:00:00.000Z" },
      { pages: [doc("# New")], run: "run-9", snapshot: "snap-old" },
      "2026-10-21T10:00:00.000Z",
    );
    expect(next?.versions?.map((entry) => [entry.version, entry.snapshot])).toEqual([
      [1, "snap-old"],
      [2, undefined],
    ]);
    // The old page had no id: it gets one by place and counts as changed only if it did.
    const kept = nextPresentation(
      { pages: [doc("# Old"), doc("# Ask")], updatedAt: "2026-10-20T10:00:00.000Z" },
      { pages: [doc("# Old", "page-1"), doc("# Ask v2", "page-2")], run: "run-9", snapshot: "s" },
      "2026-10-21T10:00:00.000Z",
    );
    expect(kept?.pages.map((page) => [page.id, page.revision])).toEqual([
      ["page-1", 1],
      ["page-2", 2],
    ]);
  });

  it("removes the presentation when no pages are left", () => {
    expect(
      nextPresentation(
        { pages: [doc("# Old")], updatedAt: "2026-10-20T10:00:00.000Z" },
        { pages: [], run: "run-1", snapshot: undefined },
        "2026-10-21T10:00:00.000Z",
      ),
    ).toBeUndefined();
  });
});

describe("applyPresentationEdit", () => {
  const pages = withPageIds([doc("a", "intro"), doc("b", "shot"), doc("c", "ask")], [], true);

  it("replaces by id in place, adds new pages at the end, removes and reorders", () => {
    const next = applyPresentationEdit(pages, {
      put: [doc("b2", "shot"), doc("d")],
      remove: ["intro"],
      order: ["ask"],
    });
    expect(typeof next === "string" ? next : next.map((page) => page.id)).toEqual([
      "ask",
      "shot",
      "page-1",
    ]);
    expect(typeof next !== "string" && next[1]?.kind === "doc" && next[1].markdown).toBe("b2");
  });

  it("says what is wrong with an id that is not there", () => {
    expect(applyPresentationEdit(pages, { remove: ["nope"] })).toBe(
      'There is no page "nope" to remove.',
    );
    expect(applyPresentationEdit(pages, { order: ["nope"] })).toBe(
      'There is no page "nope" to order.',
    );
  });
});
