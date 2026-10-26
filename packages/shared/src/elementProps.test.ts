import type { ElementManifest } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { elementBlocks, elementProblems } from "./elementProps.ts";

const poll: ElementManifest = {
  tag: "t3-poll",
  description: "Pick several.",
  props: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array" },
      note: { type: "boolean" },
    },
    required: ["question", "options"],
  },
};
const callout: ElementManifest = {
  tag: "t3-callout",
  description: "A note.",
  body: "text:body",
  props: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } } },
};
const library = new Map([
  [poll.tag, poll],
  [callout.tag, callout],
]);

describe("elementProblems", () => {
  it("names the prop a finished reply got wrong, with the block as written", () => {
    const block = '<t3-poll>\n{"question":"Which?","options":[],"note":"Pick two."}\n</t3-poll>';
    expect(elementProblems(`Here:\n\n${block}\n\nThanks.`, library)).toEqual([
      { tag: "t3-poll", errors: ['"note" should be boolean, got string.'], source: block },
    ]);
  });

  it("checks fields inside array items, where components would draw a placeholder", () => {
    const steps: ElementManifest = {
      tag: "t3-steps",
      description: "A timeline.",
      props: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                state: { type: "string", enum: ["done", "todo"] },
              },
              required: ["title"],
            },
          },
        },
        required: ["steps"],
      },
    };
    const reply = (body: string) =>
      elementProblems(`<t3-steps>\n${body}\n</t3-steps>`, new Map([[steps.tag, steps]]));

    expect(reply('{"steps":[{"label":"Merge","status":"done"}]}')[0]?.errors).toEqual([
      'Missing "steps[0].title".',
      'Unknown "steps[0].label"; the fields are title, state.',
      'Unknown "steps[0].status"; the fields are title, state.',
    ]);
    expect(reply('{"steps":[{"title":"Merge","state":"later"}]}')[0]?.errors).toEqual([
      '"steps[0].state" should be one of "done", "todo".',
    ]);
    expect(reply('{"steps":[{"title":"Merge","state":"done"}]}')).toEqual([]);
  });

  it("passes components the chat draws, including text bodies and entities", () => {
    const text = [
      '<t3-poll>\n{"question":"A &amp; B?","options":[]}\n</t3-poll>',
      '<t3-callout title="Heads up">Body text</t3-callout>',
    ].join("\n\n");
    expect(elementProblems(text, library)).toEqual([]);
    expect(elementBlocks(text)[0]?.body.trim()).toBe('{"question":"A & B?","options":[]}');
  });

  it("flags unknown tags, bad JSON, self-closing and unclosed tags", () => {
    const problems = elementProblems(
      [
        "<t3-option>x</t3-option>",
        "<t3-poll>\n{question: 1}\n</t3-poll>",
        '<t3-callout title="a" />',
        "<t3-poll>\n{}",
      ].join("\n\n"),
      library,
    );
    expect(problems.map((problem) => problem.errors[0]?.split(" ").slice(0, 3).join(" "))).toEqual([
      "Unknown component <t3-option>.",
      "The body is",
      "<t3-callout/> is self-closing;",
      "<t3-poll> has no",
    ]);
  });

  it("leaves code samples and mid-sentence mentions alone", () => {
    const text = [
      "Use `<t3-poll>` for that, or a <t3-bogus> tag.",
      "```html",
      "<t3-poll>\n{}\n</t3-poll>",
      "```",
      "```md",
      "```js",
      "<t3-poll>\n{}\n</t3-poll>",
      "```",
      "```",
    ].join("\n");
    expect(elementProblems(text, library)).toEqual([]);
  });
});
