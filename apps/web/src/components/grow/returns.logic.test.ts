import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { GrowCard } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGrowDeck,
  buildGrowRelations,
  cleanLabel,
  filterGrowDeck,
  growCurrent,
  growDeckItems,
  growEntry,
  growFocusedProject,
  growHeadline,
  growNextAfter,
  growPrimary,
  growProjectOpen,
  growQueue,
  growSpark,
  growStep,
  supersedeCandidates,
  supersededChain,
} from "./returns.logic";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const shell = (id: string, overrides: Record<string, unknown> = {}): EnvironmentThreadShell =>
  ({
    id,
    environmentId: "env",
    projectId: "p1",
    title: id,
    archivedAt: null,
    deletedAt: null,
    lineage: { relationshipToParent: null },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestRun: { runId: "run" },
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: null,
    createdAt: hoursAgo(1),
    pullRequests: [],
    previewLinks: [],
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

const preview = (label?: string) => [{ url: "https://x.pv.nepjua.org/?demo=a", label }];
const pr = (state: string) => [
  { url: "https://pr/1", number: 1, source: "agent", snapshot: { state } },
];
const card = (threadId: string, decision: GrowCard["decision"], updatedAt: string) =>
  [
    `env:${threadId}`,
    { threadId, decision, updatedAt, lessons: [] } as unknown as GrowCard,
  ] as const;

const keys = (items: ReadonlyArray<{ readonly thread: { readonly id: string } }>) =>
  items.map((item) => item.thread.id);

describe("pinned threads", () => {
  const pinnedAt = hoursAgo(5);

  it("lists a pinned thread whatever state it is in, in pin order", () => {
    const deck = buildGrowDeck(
      [
        shell("settled-chat", { pinnedAt, settledOverride: "settled", pinOrderKey: "b" }),
        shell("ancient", {
          pinnedAt,
          pinOrderKey: "a",
          latestUserMessageAt: hoursAgo(24 * 40),
          latestRun: { completedAt: hoursAgo(24 * 40) },
          updatedAt: hoursAgo(24 * 40),
        }),
        shell("recent", { pinnedAt, pinOrderKey: "c", previewLinks: preview() }),
        shell("plain"),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.pinned)).toEqual(["ancient", "settled-chat", "recent"]);
    expect(keys(deck.returns)).toEqual(["plain"]);
    expect(keys(growDeckItems(deck))).toContain("settled-chat");
  });

  it("leaves a pinned thread that is running or needs the user in its own section", () => {
    const deck = buildGrowDeck(
      [
        shell("busy", { pinnedAt, runtime: { status: "running" } }),
        shell("asks", { pinnedAt, hasPendingUserInput: true }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.working)).toEqual(["busy"]);
    expect(keys(deck.urgent)).toEqual(["asks"]);
    expect(deck.pinned).toEqual([]);
  });

  it("still leaves out archived pinned threads", () => {
    const deck = buildGrowDeck(
      [shell("gone", { pinnedAt, archivedAt: hoursAgo(1) })],
      new Map(),
      NOW,
    );
    expect(deck.pinned).toEqual([]);
  });
});

describe("growEntry", () => {
  it("makes a list item for a thread the deck leaves out", () => {
    // Never started: nothing came back, so the deck leaves it out.
    const thread = shell("empty-chat", { latestRun: null });
    const deck = buildGrowDeck([thread], new Map(), NOW);
    expect(growDeckItems(deck)).toEqual([]);
    const entry = growEntry(thread, undefined, "return");
    expect(entry.key).toBe("env:empty-chat");
    expect(entry.headline).toBe("empty-chat");
  });
});

describe("buildGrowDeck", () => {
  it("sorts threads into what needs the user, returns, shipped, settled and working", () => {
    const deck = buildGrowDeck(
      [
        shell("asks", { hasPendingUserInput: true }),
        shell("busy", { runtime: { status: "running" }, previewLinks: preview() }),
        shell("made", { previewLinks: preview(), settledOverride: "settled" }),
        shell("chat", { settledOverride: "settled" }),
        shell("merged", { pullRequests: pr("merged"), settledOverride: "settled" }),
        shell("finished"),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.urgent)).toEqual(["asks"]);
    expect(keys(deck.returns)).toEqual(["finished"]);
    expect(keys(deck.shipped)).toEqual(["merged"]);
    // Settled threads wait on the shelf, a preview or not, instead of in the list to decide on.
    expect(keys(deck.letGo).toSorted()).toEqual(["chat", "made"]);
    expect(deck.working).toHaveLength(1);
  });

  it("puts a report that asks the user first, until they write back or it settles", () => {
    const asks = {
      statusOutcome: "needs-you",
      statusUpdatedAt: hoursAgo(1),
      latestUserMessageAt: hoursAgo(2),
    };
    const deck = buildGrowDeck(
      [
        shell("waiting", asks),
        shell("answered", { ...asks, latestUserMessageAt: hoursAgo(0.5) }),
        shell("settled", { ...asks, settledOverride: "settled" }),
        shell("pinned", { pinnedAt: hoursAgo(5), pinOrderKey: "a" }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.urgent)).toEqual(["waiting"]);
    expect(deck.urgent[0]?.reason).toBe("asks");
    expect(keys(deck.returns)).toEqual(["answered"]);
    expect(keys(deck.letGo)).toEqual(["settled"]);
    // The list leads with what waits on the user, and stepping follows the list.
    expect(keys(growDeckItems(deck)).slice(0, 2)).toEqual(["waiting", "pinned"]);
  });

  it("keeps a decision until the user writes to the thread again", () => {
    const decidedAt = hoursAgo(2);
    const deck = buildGrowDeck(
      [
        shell("dropped", { previewLinks: preview(), latestUserMessageAt: hoursAgo(3) }),
        shell("revived", { previewLinks: preview(), latestUserMessageAt: hoursAgo(1) }),
        shell("shipping", {
          previewLinks: preview(),
          latestUserMessageAt: hoursAgo(3),
          latestRun: { completedAt: hoursAgo(1) },
        }),
      ],
      new Map([
        card("dropped", "shelve", decidedAt),
        card("revived", "shelve", decidedAt),
        card("shipping", "adopt", decidedAt),
      ]),
      NOW,
    );
    expect(keys(deck.letGo)).toEqual(["dropped"]);
    expect(keys(deck.returns)).toEqual(["revived"]);
    expect(keys(deck.shipped)).toEqual(["shipping"]);
    expect(deck.shipped[0]?.merged).toBe(false);
  });

  it("hands a shipped thread back when its agent was blocked, until the user writes again", () => {
    const shipped = { previewLinks: preview(), latestUserMessageAt: hoursAgo(3) };
    const deck = buildGrowDeck(
      [
        shell("blocked", { ...shipped, growBlockedAt: hoursAgo(2) }),
        shell("answered", {
          ...shipped,
          growBlockedAt: hoursAgo(2),
          latestUserMessageAt: hoursAgo(1),
        }),
      ],
      new Map([card("blocked", "adopt", hoursAgo(3)), card("answered", "adopt", hoursAgo(3))]),
      NOW,
    );
    expect(keys(deck.urgent)).toEqual(["blocked"]);
    expect(deck.urgent[0]?.reason).toBe("blocked");
    expect(keys(deck.returns)).toEqual(["answered"]);
  });

  it("folds earlier returns and drops the ones past two weeks", () => {
    const deck = buildGrowDeck(
      [
        shell("today", { previewLinks: preview() }),
        shell("lastWeek", { previewLinks: preview(), createdAt: hoursAgo(24 * 6) }),
        shell("ancient", { previewLinks: preview(), createdAt: hoursAgo(24 * 20) }),
        shell("empty", { title: "New thread", latestRun: null }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.returns)).toEqual(["today"]);
    expect(keys(deck.older)).toEqual(["lastWeek"]);
  });

  it("keeps a project's returns together, newest project first", () => {
    const deck = buildGrowDeck(
      [
        shell("a-old", { projectId: "a", createdAt: hoursAgo(5) }),
        shell("b-new", { projectId: "b", createdAt: hoursAgo(1) }),
        shell("a-new", { projectId: "a", createdAt: hoursAgo(2) }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.returns)).toEqual(["b-new", "a-new", "a-old"]);
  });

  it("skips pending decisions, excluded threads and subagents", () => {
    const deck = buildGrowDeck(
      [
        shell("pending"),
        shell("manager"),
        shell("sub", { lineage: { relationshipToParent: "subagent" } }),
        shell("kept"),
      ],
      new Map(),
      NOW,
      { pending: new Set(["env:pending"]), excluded: new Set(["env:manager"]) },
    );
    expect(keys(growQueue(deck))).toEqual(["kept"]);
  });
});

describe("growPrimary", () => {
  const deck = buildGrowDeck(
    [
      shell("changes"),
      shell("open-pr", { pullRequests: pr("open") }),
      shell("closed-pr", { pullRequests: pr("closed"), previewLinks: preview() }),
      shell("report", { title: "Report: weekly", previewLinks: preview() }),
    ],
    new Map(),
    NOW,
  );
  const primary = (id: string, asks = false) => {
    const item = growQueue(deck).find((candidate) => candidate.thread.id === id);
    if (item === undefined) throw new Error(id);
    return growPrimary(item, asks);
  };

  it("ships only what can land, and answers a question first", () => {
    expect(primary("changes")).toBe("ship");
    expect(primary("open-pr")).toBe("ship");
    expect(primary("closed-pr")).toBe("done");
    expect(primary("report")).toBe("done");
    expect(primary("open-pr", true)).toBe("reply");
  });
});

describe("cleanLabel", () => {
  it("drops demo ids and URLs the agent left in a title", () => {
    expect(cleanLabel("Feud card: both acts (?demo=crisis-feud)")).toBe("Feud card: both acts");
    expect(cleanLabel("Look at https://x.pv.nepjua.org/?demo=a now")).toBe("Look at now");
    expect(cleanLabel("https://x.org")).toBe("https://x.org");
  });
});

describe("growHeadline", () => {
  it("prefers what the agent named the preview over a generic label", () => {
    expect(growHeadline(shell("t", { previewLinks: preview("Studio upgrade") }))).toBe(
      "Studio upgrade",
    );
    expect(growHeadline(shell("t", { previewLinks: preview("Önizleme") }))).toBe("t");
    expect(growHeadline(shell("t", { previewLinks: preview("https://x.org") }))).toBe("t");
  });
});

describe("growCurrent", () => {
  const deck = buildGrowDeck(
    [
      shell("one", { createdAt: hoursAgo(1) }),
      shell("two", { createdAt: hoursAgo(2) }),
      shell("three", { createdAt: hoursAgo(3) }),
    ],
    new Map(),
    NOW,
  );

  it("shows the selection while it is there and moves on past a decided one", () => {
    expect(growCurrent(deck, "env:two")?.thread.id).toBe("two");
    expect(growCurrent(deck, "env:gone")?.thread.id).toBe("one");
    expect(growNextAfter(deck, "env:two")).toBe("env:three");
    expect(growNextAfter(deck, "env:three")).toBe("env:two");
  });

  it("steps through the deck and wraps around at the ends", () => {
    expect(growStep(deck, "env:one", 1)).toBe("env:two");
    expect(growStep(deck, "env:one", -1)).toBe("env:three");
    expect(growStep(deck, "env:three", 1)).toBe("env:one");
  });
});

describe("growSpark and filterGrowDeck", () => {
  it("resurfaces the longest-waiting playable let-go idea and filters by name", () => {
    const decidedAt = hoursAgo(0.5);
    const deck = buildGrowDeck(
      [
        shell("fresh-drop", { previewLinks: preview(), createdAt: hoursAgo(1) }),
        shell("old-drop", { previewLinks: preview(), createdAt: hoursAgo(30) }),
        shell("no-play", { createdAt: hoursAgo(60) }),
      ],
      new Map([
        card("fresh-drop", "shelve", decidedAt),
        card("old-drop", "shelve", decidedAt),
        card("no-play", "shelve", decidedAt),
      ]),
      NOW,
    );
    expect(growSpark(deck)?.thread.id).toBe("old-drop");
    expect(keys(filterGrowDeck(deck, "FRESH").letGo)).toEqual(["fresh-drop"]);
  });
});

describe("buildGrowRelations", () => {
  it("links forks and manager-recorded parents to their parent, leaving out subagents", () => {
    const relations = buildGrowRelations(
      [
        shell("root"),
        shell("fork", {
          createdAt: hoursAgo(2),
          lineage: { relationshipToParent: "fork", parentThreadId: "root" },
        }),
        shell("launched", { createdAt: hoursAgo(3) }),
        shell("helper", { lineage: { relationshipToParent: "subagent", parentThreadId: "root" } }),
      ],
      new Map([
        [
          "env:launched",
          { threadId: "launched", parentThreadId: "root", lessons: [] } as unknown as GrowCard,
        ],
      ]),
    );
    expect(keys((relations.children.get("env:root") ?? []).map((thread) => ({ thread })))).toEqual([
      "launched",
      "fork",
    ]);
    expect(relations.byKey.get("env:helper")?.id).toBe("helper");
  });
});

describe("supersede links", () => {
  const link = (threadId: string, note = "", linkedHoursAgo = 0) => ({
    supersededBy: { threadId, note, at: hoursAgo(linkedHoursAgo) },
  });
  const threads = [
    shell("rows", { ...link("stack", "Folded into the stack", 1), createdAt: hoursAgo(5) }),
    shell("keys", { ...link("stack", "", 2), createdAt: hoursAgo(4) }),
    shell("stack", { ...link("next", "Carried on"), updatedAt: hoursAgo(3) }),
    shell("next", { updatedAt: hoursAgo(2) }),
    shell("other-project", { projectId: "p2", updatedAt: hoursAgo(0) }),
    shell("fresh", { updatedAt: hoursAgo(1) }),
    shell("child", {
      updatedAt: hoursAgo(9),
      lineage: { relationshipToParent: "fork", parentThreadId: "rows" },
    }),
  ];
  const relations = buildGrowRelations(threads, new Map());

  it("indexes the threads each one superseded, in the order they were folded in", () => {
    expect(relations.supersedes.get("env:stack")?.map((thread) => thread.id)).toEqual([
      "keys",
      "rows",
    ]);
  });

  it("follows the chain forward and stops at a loop written by an older server", () => {
    const rows = relations.byKey.get("env:rows")!;
    expect(supersededChain(relations, rows).map((step) => [step.thread.id, step.note])).toEqual([
      ["stack", "Folded into the stack"],
      ["next", "Carried on"],
    ]);
    const looped = buildGrowRelations([shell("a", link("b")), shell("b", link("a"))], new Map());
    expect(
      supersededChain(looped, looped.byKey.get("env:a")!).map((step) => step.thread.id),
    ).toEqual(["b"]);
  });

  it("suggests related threads first, then the project, never one behind it in the chain or already superseded", () => {
    const stack = relations.byKey.get("env:stack")!;
    const ids = (thread: EnvironmentThreadShell, query = "", parentKey: string | null = null) =>
      supersedeCandidates({ thread, relations, parentKey, query }).map((item) => item.id);
    // rows and keys were folded into stack: picking them would loop.
    expect(ids(stack)).toEqual(["fresh", "next", "child", "other-project"]);
    // stack and keys are superseded themselves, so the work does not live on there.
    expect(ids(relations.byKey.get("env:rows")!)).toEqual([
      "child",
      "fresh",
      "next",
      "other-project",
    ]);
    expect(ids(stack, "nex")).toEqual(["next"]);
  });
});

describe("project folding", () => {
  const deck = buildGrowDeck(
    [
      shell("a", { projectId: "p1" }),
      shell("b", { projectId: "p2" }),
      shell("c", { projectId: "p3", runtime: { running: true } }),
    ],
    new Map(),
    NOW,
    { excluded: new Set(), pending: new Set() },
  );

  it("opens only the project of the shown item, wherever the deck lists it", () => {
    const projects = ["env:p1", "env:p2", "env:p3"];
    const openFor = (key: string | null) =>
      projects.filter((project) => growProjectOpen(project, growFocusedProject(deck, key), false));
    expect(openFor("env:a")).toEqual(["env:p1"]);
    expect(openFor("env:b")).toEqual(["env:p2"]);
    expect(openFor(null)).toEqual([]);
  });

  it("opens every project when expanded, and goes back to one when it is not", () => {
    const focused = growFocusedProject(deck, "env:a");
    expect(["env:p1", "env:p2", "env:p3"].map((p) => growProjectOpen(p, focused, true))).toEqual([
      true,
      true,
      true,
    ]);
    expect(["env:p1", "env:p2", "env:p3"].map((p) => growProjectOpen(p, focused, false))).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("last interaction order", () => {
  const threads = [
    // a1 was agent-updated long ago but the user wrote to it most recently.
    shell("a1", {
      projectId: "p1",
      latestUserAuthoredMessageAt: hoursAgo(1.5),
      updatedAt: hoursAgo(9),
    }),
    shell("b1", {
      projectId: "p2",
      latestUserAuthoredMessageAt: hoursAgo(2),
      updatedAt: hoursAgo(1),
    }),
    shell("a2", {
      projectId: "p1",
      latestUserAuthoredMessageAt: hoursAgo(4),
      updatedAt: hoursAgo(6),
    }),
    shell("c1", {
      projectId: "p3",
      latestUserAuthoredMessageAt: hoursAgo(3),
      updatedAt: hoursAgo(7),
    }),
  ];
  const build = (grouping?: "projects" | "recent") =>
    buildGrowDeck(threads, new Map(), NOW, grouping ? { grouping } : {});

  it("orders projects and the threads inside them by when the user last wrote", () => {
    // p1 holds the most recent word (a1), so its threads come first and stay together.
    expect(keys(build().returns)).toEqual(["a1", "a2", "b1", "c1"]);
  });

  it("lists flat, last touched first, in the recent mode", () => {
    expect(keys(build("recent").returns)).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("does not count the manager writing on the user's behalf", () => {
    const deck = buildGrowDeck(
      [
        shell("x", { latestUserAuthoredMessageAt: hoursAgo(8), latestUserMessageAt: hoursAgo(1) }),
        shell("y", { latestUserAuthoredMessageAt: hoursAgo(3), latestUserMessageAt: hoursAgo(3) }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.returns)).toEqual(["y", "x"]);
  });
});

describe("snoozed threads", () => {
  const until = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
  const snoozedAt = hoursAgo(2);

  it("leaves every other section for the Snoozed one, soonest wake first", () => {
    const deck = buildGrowDeck(
      [
        shell("later", { snoozedAt, snoozedUntil: until(20), previewLinks: preview() }),
        shell("soon", { snoozedAt, snoozedUntil: until(1) }),
        shell("pinned", { snoozedAt, snoozedUntil: until(5), pinnedAt: hoursAgo(5) }),
        shell("awake", { previewLinks: preview() }),
      ],
      new Map(),
      NOW,
    );
    expect(keys(deck.snoozed)).toEqual(["soon", "pinned", "later"]);
    expect(deck.snoozed.every((item) => item.kind === "snoozed")).toBe(true);
    expect(keys(deck.returns)).toEqual(["awake"]);
    expect(deck.pinned).toEqual([]);
    // Still reachable: the deck can show it, and stepping walks to it, but it is no decision.
    expect(keys(growDeckItems(deck))).toEqual(["awake", "soon", "pinned", "later"]);
    expect(keys(growQueue(deck))).toEqual(["awake"]);
  });

  it("brings a thread back as fresh news when its wake time passes", () => {
    const thread = shell("woke", {
      snoozedAt: hoursAgo(72),
      snoozedUntil: hoursAgo(1),
      previewLinks: preview(),
      // Idle for days: without the wake it would sit in "earlier".
      latestRun: { runId: "run", completedAt: hoursAgo(100) },
      updatedAt: hoursAgo(100),
    });
    const deck = buildGrowDeck([thread], new Map(), NOW);
    expect(deck.snoozed).toEqual([]);
    expect(keys(deck.returns)).toEqual(["woke"]);
    // A minute before the wake it was still parked.
    const before = buildGrowDeck([thread], new Map(), NOW - 2 * 3_600_000);
    expect(keys(before.snoozed)).toEqual(["woke"]);
  });

  it("wakes early when the agent needs the user", () => {
    const deck = buildGrowDeck(
      [shell("blocked", { snoozedAt, snoozedUntil: until(20), hasPendingApprovals: true })],
      new Map(),
      NOW,
    );
    expect(deck.snoozed).toEqual([]);
  });

  it("finds a snoozed thread by search and by its project", () => {
    const deck = buildGrowDeck(
      [shell("quiet", { snoozedAt, snoozedUntil: until(3) })],
      new Map(),
      NOW,
    );
    expect(keys(filterGrowDeck(deck, "quie").snoozed)).toEqual(["quiet"]);
    expect(keys(filterGrowDeck(deck, "nope").snoozed)).toEqual([]);
    expect(growFocusedProject(deck, "env:quiet")).toBe("env:p1");
  });
});
