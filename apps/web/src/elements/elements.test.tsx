import type { ElementManifest } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { describe, expect, it } from "vite-plus/test";

import { elementProps } from "@t3tools/shared/elementProps";

import { elementPlainText, trimPartialElementTag } from "./elementProps";
import { ELEMENT_SLOT_PROPERTIES, rehypeElements } from "./rehypeElements";

const decision: ElementManifest = {
  tag: "t3-decision",
  description: "A question with options.",
  body: "json",
  props: {
    type: "object",
    properties: { question: { type: "string" }, options: { type: "array" } },
    required: ["question", "options"],
  },
};

const callout: ElementManifest = {
  tag: "t3-callout",
  description: "A toned note.",
  body: "text:text",
  props: {
    type: "object",
    properties: {
      tone: { type: "string" },
      title: { type: "string" },
      text: { type: "string" },
      count: { type: "number" },
    },
  },
};

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ...ELEMENT_SLOT_PROPERTIES],
  },
};

/** What the chat's markdown pipeline makes of a message, with slots shown as their data. */
function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeElements, [rehypeSanitize, schema]]}>
      {markdown}
    </ReactMarkdown>,
  );
}

describe("element props", () => {
  it("reads a JSON body", () => {
    const result = elementProps({
      manifest: decision,
      attributes: {},
      body: '{"question":"Which?","options":[{"label":"A"}]}',
      streaming: false,
    });
    expect(result).toEqual({
      kind: "ok",
      props: { question: "Which?", options: [{ label: "A" }] },
    });
  });

  it("waits on a half-streamed body, and calls it invalid once the message is done", () => {
    const input = { manifest: decision, attributes: {}, body: '{"question":"Wh' };
    expect(elementProps({ ...input, streaming: true })).toEqual({ kind: "pending" });
    const done = elementProps({ ...input, streaming: false });
    expect(done.kind).toBe("invalid");
  });

  it("names a missing required prop and a wrong type", () => {
    const result = elementProps({
      manifest: decision,
      attributes: {},
      body: '{"question":42}',
      streaming: false,
    });
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors.join(" ")).toContain('Missing "options"');
      expect(result.errors.join(" ")).toContain('"question" should be string');
    }
  });

  it("takes a text body and coerces attributes by the schema", () => {
    const result = elementProps({
      manifest: callout,
      attributes: { tone: "warning", count: "3", class: "x", "data-x": "1" },
      body: "  Heads up  ",
      streaming: false,
    });
    expect(result).toEqual({
      kind: "ok",
      props: { tone: "warning", count: 3, text: "Heads up", dataX: "1" },
    });
  });

  it("holds back a tag cut in half by streaming", () => {
    expect(trimPartialElementTag("Here:\n\n<t3-deci")).toBe("Here:\n\n");
    expect(trimPartialElementTag("Done </t3-decision>")).toBe("Done </t3-decision>");
  });

  it("reads JSON props as plain text for copy", () => {
    expect(elementPlainText('{"question":"Which?","options":[{"label":"A"}]}')).toBe("Which? · A");
  });
});

describe("markdown pipeline", () => {
  it("turns a library tag into a slot that carries its body", () => {
    const html = render(
      'Pick one:\n\n<t3-decision>\n{"question":"Which?"}\n</t3-decision>\n\nThanks.',
    );
    expect(html).toContain('data-t3-element="t3-decision"');
    expect(html).toContain("&quot;question&quot;");
    expect(html).toContain("Pick one:");
    expect(html).toContain("Thanks.");
  });

  it("keeps an inline text-body tag inside its paragraph", () => {
    const html = render('<t3-callout tone="warning" title="Heads up">Body text</t3-callout>');
    expect(html).toContain('data-t3-element="t3-callout"');
    expect(html).toContain("&quot;tone&quot;:&quot;warning&quot;");
    expect(html).toContain('data-t3-body="Body text"');
  });

  it("never lets a script, an inline handler or a javascript: link through", () => {
    const html = render(
      [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(2)">',
        '<a href="javascript:alert(3)">click</a>',
        '<t3-decision onclick="alert(4)">',
        '{"question":"Safe?"}',
        "</t3-decision>",
      ].join("\n\n"),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/onerror=|onclick=/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("alert(4)");
    expect(html).toContain('data-t3-element="t3-decision"');
  });
});
