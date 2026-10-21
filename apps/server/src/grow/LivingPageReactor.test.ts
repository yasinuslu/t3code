import { describe, expect, it } from "@effect/vitest";

import { acceptBlocks } from "./LivingPageReactor.ts";

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
