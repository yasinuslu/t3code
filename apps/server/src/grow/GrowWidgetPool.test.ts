import { describe, expect, it } from "@effect/vitest";

import { compileWidget, poolCatalog, readWidgetMeta } from "./GrowWidgetPool.ts";

const WIDGET = `import { Badge } from "t3/ui";
import { useT3 } from "t3/widget";

export const meta = {
  description: "A status chip.",
  props: { type: "object", properties: { label: { type: "string" } } },
  example: { label: "Ready" },
};

export default function Chip(props: { label?: string }) {
  const t3 = useT3();
  return <Badge>{props.label ?? t3.thread.title}</Badge>;
}
`;

describe("GrowWidgetPool", () => {
  it("compiles a widget and reads its meta without rendering it", () => {
    const code = compileWidget(WIDGET, "Chip");
    expect(code).toMatch(/require\(['"]t3\/ui['"]\)/);
    expect(readWidgetMeta(code)).toEqual({
      description: "A status chip.",
      props: { type: "object", properties: { label: { type: "string" } } },
      example: { label: "Ready" },
    });
  });

  it("refuses a widget without a component or a description", () => {
    expect(() =>
      readWidgetMeta(compileWidget(`export const meta = { description: "x" };`, "A")),
    ).toThrow(/default-exported component/);
    expect(() =>
      readWidgetMeta(compileWidget(`export default function A() { return null; }`, "A")),
    ).toThrow(/description/);
  });

  it("stops a widget whose top level never returns", () => {
    expect(() =>
      readWidgetMeta(
        compileWidget(`while (true) {}\nexport default function A() { return null; }`, "A"),
      ),
    ).toThrow();
  });

  it("lists every widget for the writer with its props and example", () => {
    const code = compileWidget(WIDGET, "Chip");
    const catalog = poolCatalog({
      dir: "/pool",
      readme: "",
      widgets: [{ name: "Chip", code, meta: readWidgetMeta(code) }],
      broken: [],
    });
    expect(catalog).toContain("### Chip\nA status chip.");
    expect(catalog).toContain('example: {"label":"Ready"}');
  });
});
