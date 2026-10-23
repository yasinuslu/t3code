// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";

import { describeElements, elementsInstructions } from "./ElementsLibrary.ts";

const components = [
  {
    tag: "t3-decision",
    description: "Ask the user to pick one option. Sends the answer back as the next message.",
    interactive: true,
    props: {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string", description: "long text" }, options: {} },
    },
    example: { question: "Which?" },
  },
  {
    tag: "t3-note",
    description: "A note.",
    body: "text:text",
    props: { type: "object", properties: {} },
  },
  { tag: "t3-secret", description: "Hidden.", hidden: true, props: {} },
];

function withLibrary<T>(run: () => T): T {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "elements-lib-"));
  NodeFS.mkdirSync(NodePath.join(dir, "dist"));
  NodeFS.writeFileSync(
    NodePath.join(dir, "dist", "manifest.json"),
    JSON.stringify({ hash: "h", components }),
  );
  NodeFS.writeFileSync(NodePath.join(dir, "dist", "t3-elements.js"), "");
  const previous = process.env.T3CODE_ELEMENTS_LIBRARY;
  process.env.T3CODE_ELEMENTS_LIBRARY = dir;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.T3CODE_ELEMENTS_LIBRARY;
    else process.env.T3CODE_ELEMENTS_LIBRARY = previous;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
}

it("lists one compact line per visible component, without examples or prop text", () => {
  withLibrary(() => {
    const text = elementsInstructions();
    expect(text).toContain(
      "<t3-decision> (interactive) - Ask the user to pick one option; props: question*, options",
    );
    expect(text).toContain("<t3-note> - A note. [text body = text]".replace(". [", " ["));
    expect(text).not.toContain("t3-secret");
    expect(text).not.toContain("long text");
    expect(text).toContain("elements_describe");
  });
});

it("describes full entries, reports unknown tags with close names, lists the catalog", () => {
  withLibrary(() => {
    const described = describeElements(["t3-decision", "<t3-decisio>", "t3-nope"]);
    expect(described.components[0]).toMatchObject({
      tag: "t3-decision",
      body: "json",
      interactive: true,
      example: { question: "Which?" },
    });
    expect(described.components[1]?.error).toContain("Close names: t3-decision");
    expect(described.components[2]?.error).toContain("Unknown component t3-nope");
    expect(describeElements([]).catalog).toContain("<t3-note>");
  });
});

it("tells the agent when to reach for a component and when to stay plain", () => {
  withLibrary(() => {
    const text = elementsInstructions();
    expect(text).toContain("## When to reach for one");
    expect(text).toContain("opens with t3-headline");
    expect(text).toContain('Never ask the user to "reply with a number"');
    expect(text).toContain("Stay plain for a short conversational reply");
  });
});
