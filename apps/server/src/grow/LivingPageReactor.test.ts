import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { acceptBlocks, formatLivingPageContext } from "./LivingPageReactor.ts";

describe("acceptBlocks", () => {
  const known = new Set(["Headline", "Shot"]);

  it("keeps known widgets whose props parse to an object", () => {
    expect(
      acceptBlocks(
        [
          { widget: "Headline", span: "full", propsJson: '{"title":"Fund hint"}' },
          { widget: "Shot", span: "half", propsJson: '{"image":"attachment:a1"}' },
        ],
        known,
      ),
    ).toEqual([
      { widget: "Headline", props: { title: "Fund hint" } },
      { widget: "Shot", props: { image: "attachment:a1" }, span: "half" },
    ]);
  });

  it("drops unknown widgets and props that are not a JSON object", () => {
    expect(
      acceptBlocks(
        [
          { widget: "Mystery", span: "full", propsJson: "{}" },
          { widget: "Headline", span: "full", propsJson: "{not json" },
          { widget: "Headline", span: "full", propsJson: "[1,2]" },
          { widget: "Shot", span: "full", propsJson: "{}" },
        ],
        known,
      ),
    ).toEqual([{ widget: "Shot", props: {} }]);
  });

  it("caps a page at the block limit", () => {
    const many = Array.from({ length: 60 }, () => ({
      widget: "Headline",
      span: "full" as const,
      propsJson: "{}",
    }));
    expect(acceptBlocks(many, known)).toHaveLength(40);
  });
});

describe("formatLivingPageContext", () => {
  // Only the fields the context reads.
  const thread = { title: "Fund hint" } as OrchestrationV2AppThread;
  const context = (diff?: string) =>
    formatLivingPageContext({
      thread,
      projectTitle: "demo",
      messages: [],
      storedPaths: new Map(),
      diff,
    });

  it("gives the writer the real diff, so it quotes code instead of inventing it", () => {
    const text = context("+  return plan.budget ?? plan.estimate ?? 0;");
    expect(text).toContain("## The code changes so far (unified diff)");
    expect(text).toContain("plan.budget ?? plan.estimate ?? 0");
  });

  it("clips a large diff and leaves the section out when nothing changed", () => {
    expect(context("x".repeat(40_000)).length).toBeLessThan(20_000);
    expect(context("")).not.toContain("code changes");
    expect(context()).not.toContain("code changes");
  });
});
