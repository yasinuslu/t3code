import type { PreviewSessionSnapshot, ThreadPreviewLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findPreviewTabForUrl,
  latestPreviewLink,
  previewLinkStatePresentation,
} from "./threadPreviewLinkChip.logic";

const link = (url: string, linkedAt: string): ThreadPreviewLink =>
  ({ url, source: "agent", linkedAt }) as ThreadPreviewLink;

const session = (tabId: string, url: string | null): PreviewSessionSnapshot =>
  ({
    threadId: "thread-1",
    tabId,
    navStatus: url === null ? { _tag: "Idle" } : { _tag: "Success", url, title: "" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as PreviewSessionSnapshot;

describe("latestPreviewLink", () => {
  it("picks the newest link and counts the rest", () => {
    const result = latestPreviewLink([
      link("https://a.example", "2026-01-01T00:00:00.000Z"),
      link("https://b.example", "2026-01-03T00:00:00.000Z"),
      link("https://c.example", "2026-01-02T00:00:00.000Z"),
    ]);
    expect(result?.link.url).toBe("https://b.example");
    expect(result?.others).toBe(2);
  });

  it("is null without links", () => {
    expect(latestPreviewLink(undefined)).toBeNull();
    expect(latestPreviewLink([])).toBeNull();
  });
});

describe("previewLinkStatePresentation", () => {
  it("marks a removed preview and shows no dot for unknown", () => {
    expect(previewLinkStatePresentation("gone")).toMatchObject({ removed: true, dot: null });
    expect(previewLinkStatePresentation("unknown")).toEqual({
      label: null,
      dot: null,
      removed: false,
    });
    expect(previewLinkStatePresentation("stopped").label).toBe("Stopped: opening wakes it");
  });
});

describe("findPreviewTabForUrl", () => {
  it("prefers an exact match over a same-origin tab", () => {
    const sessions = {
      a: session("a", "https://app.example/settings"),
      b: session("b", "https://app.example/"),
    };
    expect(findPreviewTabForUrl(sessions, "https://app.example/")).toBe("b");
  });

  it("falls back to a tab that navigated within the preview's origin", () => {
    const sessions = {
      idle: session("idle", null),
      other: session("other", "https://other.example/"),
      app: session("app", "https://app.example/deep/page"),
    };
    expect(findPreviewTabForUrl(sessions, "https://app.example/")).toBe("app");
  });

  it("is null when no tab shows the preview", () => {
    expect(
      findPreviewTabForUrl({ x: session("x", "https://other.example/") }, "https://app.example"),
    ).toBeNull();
  });
});
