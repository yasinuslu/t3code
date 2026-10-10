import {
  buildWorkOverview,
  type WorkThreadInput,
} from "@t3tools/client-runtime/state/work-overview";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { digestThreadReport, homeVerdict, plainInline } from "./home.logic";

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

type TitledThread = WorkThreadInput & { readonly title: string };

describe("homeVerdict", () => {
  const thread = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
    id,
    title,
    archivedAt: null,
    deletedAt: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestRun: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: "2026-10-06T10:00:00.000Z",
    createdAt: "2026-10-06T09:00:00.000Z",
    ...overrides,
  });
  const now = Date.parse("2026-10-06T12:00:00.000Z");

  it("leads with what needs the user", () => {
    const verdict = homeVerdict(
      buildWorkOverview(
        [
          thread("a", "Fix login", { hasPendingUserInput: true }),
          thread("b", "Ship docs"),
        ] as TitledThread[],
        now,
      ),
    );
    expect(verdict).toEqual({
      tone: "attention",
      lead: "1 thread needs you:",
      detail: "Fix login",
    });
  });

  it("reports work in flight, then review, then all clear", () => {
    const running = {
      status: "running",
      activeRunId: null,
      providerInstanceId: "x",
      providerName: null,
      lastError: null,
      updatedAt: "2026-10-06T11:00:00.000Z",
    };
    expect(
      homeVerdict(
        buildWorkOverview(
          [thread("a", "Build", { runtime: running }), thread("b", "Docs")] as TitledThread[],
          now,
        ),
      ),
    ).toEqual({ tone: "busy", lead: "1 working.", detail: "1 ready for review: Docs." });
    expect(homeVerdict(buildWorkOverview([thread("b", "Docs")] as TitledThread[], now)).lead).toBe(
      "Ready to review:",
    );
    expect(homeVerdict(buildWorkOverview<TitledThread>([], now)).lead).toBe("All clear.");
  });
});
