import type { ThreadPreviewLink, ThreadPreviewLinkState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parsePreviewLinkMenuEvent,
  presentThreadPreviewChip,
  previewLinkMenuActions,
} from "./threadPreviewLinkPresentation";

const older: ThreadPreviewLink = {
  url: "http://nika:5173/",
  label: "web",
  source: "agent",
  linkedAt: "2026-10-01T10:00:00.000Z",
};
const newer: ThreadPreviewLink = {
  url: "https://preview.example.com/a|b",
  source: "user",
  linkedAt: "2026-10-02T10:00:00.000Z",
};
const labelOf = (link: ThreadPreviewLink) => link.label ?? new URL(link.url).host;

describe("presentThreadPreviewChip", () => {
  it("leads with the newest link and folds the rest into +N", () => {
    const states = new Map<string, ThreadPreviewLinkState>([[newer.url, "running"]]);
    const chip = presentThreadPreviewChip([older, newer], states, labelOf);
    expect(chip?.link).toBe(newer);
    expect(chip?.label).toBe("preview.example.com");
    expect(chip?.countLabel).toBe("+1");
    expect(chip?.status.dotClassName).not.toBeNull();
    expect(chip?.accessibilityLabel).toBe("Preview preview.example.com, Running, 1 more");
  });

  it("treats a missing state as unknown, with no dot", () => {
    const chip = presentThreadPreviewChip([older], new Map(), labelOf);
    expect(chip?.state).toBe("unknown");
    expect(chip?.status.dotClassName).toBeNull();
    expect(chip?.countLabel).toBeNull();
  });

  it("marks a gone preview as removed", () => {
    const chip = presentThreadPreviewChip([older], new Map([[older.url, "gone"]]), labelOf);
    expect(chip?.status.removed).toBe(true);
  });

  it("returns null without links", () => {
    expect(presentThreadPreviewChip([], new Map(), labelOf)).toBeNull();
  });
});

describe("preview link menu", () => {
  it("round-trips every action back to its link, even with a | in the URL", () => {
    const actions = previewLinkMenuActions([older, newer], new Map(), labelOf);
    expect(actions.map((action) => action.title)).toEqual(["preview.example.com", "web"]);
    for (const group of actions) {
      for (const action of group.subactions ?? []) {
        const parsed = parsePreviewLinkMenuEvent(action.id!, [older, newer]);
        expect(parsed?.link.url).toBe(group.id!.slice("link|".length));
      }
    }
  });

  it("is flat for a single link and ignores unknown or stale events", () => {
    const actions = previewLinkMenuActions([older], new Map(), labelOf);
    expect(actions.map((action) => action.id)).toEqual([
      `open|${older.url}`,
      `open-external|${older.url}`,
      `copy|${older.url}`,
      `remove|${older.url}`,
    ]);
    expect(parsePreviewLinkMenuEvent(`link|${older.url}`, [older])).toBeNull();
    expect(parsePreviewLinkMenuEvent(`open|${newer.url}`, [older])).toBeNull();
  });
});
