import {
  buildWorkOverview,
  type WorkThreadInput,
} from "@t3tools/client-runtime/state/work-overview";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { digestThreadReport, elementsToPlainText, plainInline } from "./home.logic";

const REPORT = `Code profiles are built, tested and pushed, and running in a dev preview on **nika**.

**URL:** http://nika:7446/ (still running). Pair once at http://nika:7446/pair?token=abc.

## Done
- **Config:** \`codeProfiles\` in \`settings.json\`, keyed by profile name
- One resolver using claude-router's rules,
  used by session launch and the import scan
- Profile badge in the thread header

## Screenshots
![yu badge](/home/me/shots/yu%20badge.png)
[import scan](/home/me/shots/import-scan.png)
[a doc](/home/me/notes.md)
![Stage, before and after](attachment:thread-1-0b7badca-606b-48c8-9102-ec8261705fcf)

\`\`\`sh
curl http://localhost:9999/ignored
\`\`\`

## Open questions
- Fix the brief "auto" label after a fresh load?
- Should the provider terminal also use the profile's Claude dir?
- A third one that does not fit
`;

describe("digestThreadReport", () => {
  it("reads summary, bullets, try links, screenshots and questions from a final report", () => {
    const digest = digestThreadReport(REPORT);
    expect(digest.summary).toBe(
      "Code profiles are built, tested and pushed, and running in a dev preview on nika.",
    );
    expect(digest.bullets).toEqual([
      "Config: codeProfiles in settings.json, keyed by profile name",
      "One resolver using claude-router's rules, used by session launch and the import scan",
      "Profile badge in the thread header",
    ]);
    expect(digest.tryUrls).toEqual(["http://nika:7446/"]);
    expect(digest.screenshots).toEqual([
      { path: "/home/me/shots/yu badge.png", alt: "yu badge" },
      { path: "/home/me/shots/import-scan.png", alt: "import scan" },
      {
        attachmentId: "thread-1-0b7badca-606b-48c8-9102-ec8261705fcf",
        alt: "Stage, before and after",
      },
    ]);
    expect(digest.questions).toEqual([
      'Fix the brief "auto" label after a fresh load?',
      "Should the provider terminal also use the profile's Claude dir?",
    ]);
  });

  it("is empty without a report and takes the first list when no section names one", () => {
    expect(digestThreadReport(null)).toEqual({
      summary: null,
      bullets: [],
      tryUrls: [],
      screenshots: [],
      questions: [],
    });
    const digest = digestThreadReport("Fixed it.\n\n- one\n- two\n\nSee https://github.com:443/x");
    expect(digest.summary).toBe("Fixed it.");
    expect(digest.bullets).toEqual(["one", "two"]);
    expect(digest.tryUrls).toEqual([]);
  });

  it("clips a long summary at a sentence", () => {
    const long = `${"A short opening sentence. ".repeat(4)}${"word ".repeat(80)}`;
    const summary = digestThreadReport(long).summary ?? "";
    expect(summary.length).toBeLessThanOrEqual(221);
    expect(summary.endsWith(".") || summary.endsWith("…")).toBe(true);
  });
});

describe("plainInline", () => {
  it("drops markdown syntax and keeps the visible text", () => {
    expect(plainInline("**Bold** and `code`, [link](http://x) and _soft_ text")).toBe(
      "Bold and code, link and soft text",
    );
  });
});

describe("components in a report", () => {
  const withHeadline = [
    "<t3-headline>",
    '{"outcome":"Every thread gets a presentation.","kicker":"T3","status":"Started","tone":"info","move":"Nothing yet"}',
    "</t3-headline>",
    "",
    "- Where it lives: one tap away.",
  ].join("\n");

  it("reads a headline's outcome as the summary, never its JSON", () => {
    const digest = digestThreadReport(withHeadline);
    expect(digest.summary).toBe("Every thread gets a presentation.");
    expect(digest.bullets).toEqual(["Where it lives: one tap away."]);
  });

  it("drops components with no words and half-written tags", () => {
    expect(elementsToPlainText('<t3-chart>{"data":[1,2]}</t3-chart>Done.')).toBe("Done.");
    expect(elementsToPlainText("Done. <t3-deci")).toBe("Done. <t3-deci");
    expect(elementsToPlainText("Done.\n</t3-decision>")).toBe("Done.\n");
  });
});
