import { describe, expect, it } from "vite-plus/test";

import { elementQuestion } from "./elementProps";
import { findComponentSourceRowId } from "./jumpToComponent";

const assistant = (id: string, text: string) => ({
  id,
  kind: "message",
  message: { role: "assistant", text },
});
const user = (id: string, text: string) => ({
  id,
  kind: "message",
  message: { role: "user", text },
});

describe("findComponentSourceRowId", () => {
  const decision = (question: string) =>
    `Pick one.\n<t3-decision>\n{"question":${JSON.stringify(question)},"options":[]}\n</t3-decision>`;

  it("finds the nearest earlier message holding the question", () => {
    const rows = [
      assistant("a1", decision("Which game next?")),
      user("u1", "Moth"),
      assistant("a2", decision("Which game next?")),
      user("u2", '[Answer to: "Which game next?"] Both are boring'),
    ];
    expect(findComponentSourceRowId(rows, "u2", "Which game next?")).toBe("a2");
    expect(findComponentSourceRowId(rows, "u1", "Which game next?")).toBe("a1");
  });

  it("ignores messages that merely mention the question and later rows", () => {
    const rows = [
      assistant("a1", "I will ask: Which game next?"),
      user("u1", "x"),
      assistant("a2", decision("Which game next?")),
    ];
    expect(findComponentSourceRowId(rows, "u1", "Which game next?")).toBeNull();
  });

  it("matches a question whose quotes were softened", () => {
    const rows = [assistant("a1", decision('Ship "it" now?')), user("u1", "yes")];
    expect(findComponentSourceRowId(rows, "u1", "Ship 'it' now?")).toBe("a1");
  });
});

describe("elementQuestion", () => {
  it("reads question, prompt or title, in that order", () => {
    expect(elementQuestion({ question: " Ship it? ", title: "T" })).toBe("Ship it?");
    expect(elementQuestion({ prompt: "Reply with one", title: "T" })).toBe("Reply with one");
    expect(elementQuestion({ title: "Pick rows" })).toBe("Pick rows");
    expect(elementQuestion({ options: [] })).toBe("");
  });
});

describe("findComponentSourceRowId with render_component rows", () => {
  it("finds the component row a reply answers", () => {
    const rows = [
      assistant("a1", "Two ways to go."),
      {
        id: "c1",
        kind: "component",
        propsJson: JSON.stringify({ question: "Which layout?", options: [] }),
      },
      user("u1", '[Answer to: "Which layout?"] Stacked'),
    ];
    expect(findComponentSourceRowId(rows, "u1", "Which layout?")).toBe("c1");
  });
});
