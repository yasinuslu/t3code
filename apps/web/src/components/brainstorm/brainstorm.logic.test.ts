import {
  type BrainstormTaskList,
  type ModelSelection,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ALL_SPACE_ID, initialSpaceState, type Space } from "../../spaceStore";
import {
  boardGoals,
  boardThreadStatus,
  needsYou,
  brainstormActivity,
  brainstormModelChoice,
  brainstormModelSelection,
  brainstormModelsOffered,
  brainstormSpacesInput,
  isBrainstormModelShortcut,
  membershipChangesToAdopt,
  otherBrainstormModel,
  toolStepsOf,
} from "./brainstorm.logic";

describe("brainstormSpacesInput", () => {
  it("classifies spaces and keeps only this environment's memberships", () => {
    const profile: Space = {
      id: "space-yu",
      name: "yu",
      color: "blue",
      icon: { kind: "monogram", text: "YU", color: "blue" },
      profile: "yu",
    };
    const custom: Space = { ...profile, id: "space-x", name: "Side", profile: null };
    const input = brainstormSpacesInput(
      {
        spaces: [initialSpaceState.spaces[0]!, profile, custom, initialSpaceState.spaces[1]!],
        customSpaceIdsByProjectKey: {
          "env-1:project-a": ["space-x"],
          "env-2:project-b": ["space-x"],
        },
      },
      "env-1",
    );
    expect(input.spaces.map((space) => [space.id, space.kind])).toEqual([
      ["all", "all"],
      ["space-yu", "profile"],
      ["space-x", "custom"],
      ["other", "other"],
    ]);
    expect(input.customSpaceIdsByProjectId).toEqual({ "project-a": ["space-x"] });
  });
});

describe("membershipChangesToAdopt", () => {
  it("adds and removes memberships to match the server for one environment", () => {
    expect(
      membershipChangesToAdopt(
        { "env-1:a": ["s1"], "env-1:b": ["s2"], "env-2:c": ["s1"] },
        { a: ["s1", "s3"], d: ["s2"] },
        "env-1",
      ),
    ).toEqual([
      ["env-1:a", "s3", true],
      ["env-1:d", "s2", true],
      ["env-1:b", "s2", false],
    ]);
  });
});

describe("toolStepsOf", () => {
  it("lists each tool call with its name and input, and skips other items", () => {
    const steps = toolStepsOf([
      {
        id: "i1",
        type: "user_message",
        status: "completed",
        title: null,
        at: "2026-09-28T00:00:00Z",
      },
      {
        id: "i2",
        type: "dynamic_tool",
        status: "completed",
        title: "MCP tool call",
        toolName: "mcp__t3-code__add_task",
        input: { title: "X" },
        at: "2026-09-28T00:00:01Z",
      },
      {
        id: "i3",
        type: "dynamic_tool",
        status: "running",
        title: null,
        toolName: "mcp__t3-code__list_tasks",
        input: {},
        at: "2026-09-28T00:00:02Z",
      },
      {
        id: "i4",
        type: "command_execution",
        status: "failed",
        title: "Run command",
        input: "git   status\n--short",
        at: "2026-09-28T00:00:03Z",
      },
      {
        id: "i5",
        type: "assistant_message",
        status: "completed",
        title: null,
        at: "2026-09-28T00:00:04Z",
      },
    ]);
    expect(steps).toEqual([
      { id: "i2", label: 'add_task {"title":"X"}', done: true, at: "2026-09-28T00:00:01Z" },
      { id: "i3", label: "list_tasks", done: false, at: "2026-09-28T00:00:02Z" },
      { id: "i4", label: "Run command git status --short", done: true, at: "2026-09-28T00:00:03Z" },
    ]);
  });

  it("shortens long labels", () => {
    const [step] = toolStepsOf([
      {
        id: "i1",
        type: "dynamic_tool",
        status: "completed",
        title: null,
        toolName: "mcp__t3-code__add_task",
        input: { title: "x".repeat(400) },
        at: "2026-09-28T00:00:01Z",
      },
    ]);
    expect(step!.label).toHaveLength(140);
    expect(step!.label.endsWith("…")).toBe(true);
  });
});

describe("brainstormActivity", () => {
  const base = {
    runStatus: "completed",
    lastError: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    awaitingSince: null,
    lastAnswerAt: "2026-09-28T10:00:00Z",
  } as const;

  it("is thinking from the send until an answer lands", () => {
    const sent = { ...base, awaitingSince: "2026-09-28T11:00:00Z" };
    expect(brainstormActivity(sent)).toEqual({ kind: "thinking" });
    expect(brainstormActivity({ ...sent, lastAnswerAt: "2026-09-28T11:00:30Z" })).toEqual({
      kind: "idle",
    });
    for (const runStatus of ["preparing", "queued", "starting", "running", "waiting"]) {
      expect(brainstormActivity({ ...base, runStatus })).toEqual({ kind: "thinking" });
    }
    expect(brainstormActivity({ ...base, runStatus: "idle" })).toEqual({ kind: "idle" });
    expect(brainstormActivity({ ...base, runStatus: "interrupted" })).toEqual({ kind: "idle" });
  });

  it("puts prompts and failures ahead of silence", () => {
    expect(
      brainstormActivity({ ...base, hasPendingApprovals: true, runStatus: "running" }),
    ).toEqual({
      kind: "needs-input",
      what: "approval",
    });
    expect(brainstormActivity({ ...base, hasPendingUserInput: true })).toEqual({
      kind: "needs-input",
      what: "answer",
    });
    expect(
      brainstormActivity({ ...base, runStatus: "failed", lastError: "Not logged in" }),
    ).toEqual({ kind: "error", message: "Not logged in" });
    expect(brainstormActivity({ ...base, runStatus: "failed" })).toEqual({
      kind: "error",
      message: "The last turn failed.",
    });
  });
});

describe("brainstorm model", () => {
  const claude = ProviderInstanceId.make("claudeAgent");
  const opus: ModelSelection = {
    instanceId: claude,
    model: "claude-opus-5-5",
    options: [{ id: "contextWindow", value: "1m" }],
  };

  it("defaults to Sonnet until the user toggles", () => {
    expect(brainstormModelChoice(undefined)).toBe("sonnet");
    expect(brainstormModelChoice("bogus")).toBe("sonnet");
    expect(brainstormModelChoice("opus")).toBe("opus");
    expect(otherBrainstormModel("sonnet")).toBe("opus");
    expect(otherBrainstormModel("opus")).toBe("sonnet");
  });

  it("moves an Opus thread to Sonnet on the same instance, dropping Opus options", () => {
    expect(brainstormModelSelection(opus, brainstormModelChoice(undefined))).toEqual({
      instanceId: claude,
      model: "claude-sonnet-5-5",
    });
  });

  it("keeps the selection untouched when it already has the chosen model", () => {
    expect(brainstormModelSelection(opus, "opus")).toBe(opus);
  });

  it("switches only instances that offer both models", () => {
    expect(
      brainstormModelsOffered([
        { slug: "claude-fable-5-1" },
        { slug: "claude-opus-5-5" },
        { slug: "claude-sonnet-5-5" },
      ]),
    ).toBe(true);
    expect(brainstormModelsOffered([{ slug: "claude-opus-5-5" }])).toBe(false);
    expect(brainstormModelsOffered(undefined)).toBe(false);
  });

  it("flips on Cmd+/ on macOS and Ctrl+/ elsewhere", () => {
    const key = (modifiers: Partial<KeyboardEvent>) => ({
      key: "/",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
    });
    expect(isBrainstormModelShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isBrainstormModelShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isBrainstormModelShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isBrainstormModelShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isBrainstormModelShortcut(key({}), true)).toBe(false);
  });
});

describe("board", () => {
  const shell = (overrides: Partial<Parameters<typeof boardThreadStatus>[0] & object> = {}) => ({
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    archivedAt: null,
    settledOverride: null,
    runtime: null,
    latestRun: null,
    ...overrides,
  });

  it("puts what needs the user before activity and outcome", () => {
    expect(boardThreadStatus(undefined)).toBe("gone");
    expect(
      boardThreadStatus(shell({ hasPendingApprovals: true, runtime: { status: "running" } })),
    ).toBe("needs-approval");
    expect(boardThreadStatus(shell({ hasPendingUserInput: true }))).toBe("needs-input");
    expect(boardThreadStatus(shell({ runtime: { status: "running" } }))).toBe("working");
    expect(boardThreadStatus(shell({ latestRun: { status: "failed" } }))).toBe("failed");
    expect(boardThreadStatus(shell({ runtime: { status: "completed" } }))).toBe("finished");
    expect(
      boardThreadStatus(shell({ settledOverride: "settled", runtime: { status: "failed" } })),
    ).toBe("settled");
    expect(boardThreadStatus(shell({ archivedAt: "2026-10-01T00:00:00Z" }))).toBe("archived");
  });

  it("lists approvals, questions and failures under Needs you", () => {
    const approval = shell({ hasPendingApprovals: true });
    const question = shell({ hasPendingUserInput: true });
    const failed = shell({ runtime: { status: "failed" } });
    const settledFailure = shell({ settledOverride: "settled", runtime: { status: "failed" } });
    const working = shell({ runtime: { status: "running" } });
    expect(needsYou([approval, working, question, settledFailure, failed])).toEqual([
      approval,
      question,
      failed,
    ]);
  });

  const task = (number: number, title: string, goal: string, done = false) => ({
    number,
    title,
    done,
    notes: [],
    threadIds: [],
    goal,
  });
  const lists: ReadonlyArray<BrainstormTaskList> = [
    {
      spaceId: "work",
      spaceName: "work",
      path: "/work-brain/tasks.md",
      profile: "work",
      goals: [
        { number: 1, title: "Inbox", done: false, notes: [] },
        { number: 2, title: "Ship it", done: false, notes: ["by Friday"] },
        { number: 3, title: "Old goal", done: true, notes: [] },
      ],
      tasks: [
        task(1, "loose", "Inbox"),
        task(2, "write tests", "Ship it", true),
        task(3, "fix bug", "Ship it"),
        task(4, "old work", "Old goal", true),
      ],
    },
    {
      spaceId: "home",
      spaceName: "home",
      path: "/home-brain/tasks.md",
      profile: "home",
      goals: [{ number: 1, title: "Garden", done: false, notes: [] }],
      tasks: [],
    },
  ];

  it("merges every brain's goals for All, Inbox last, open tasks first", () => {
    const goals = boardGoals(lists, ALL_SPACE_ID);
    expect(goals.map((goal) => [goal.spaceName, goal.title])).toEqual([
      ["work", "Ship it"],
      ["home", "Garden"],
      ["work", "Inbox"],
    ]);
    expect(goals[0]!.tasks.map((entry) => entry.title)).toEqual(["fix bug", "write tests"]);
    expect(boardGoals(lists, ALL_SPACE_ID, true).map((goal) => goal.title)).toContain("Old goal");
  });

  it("filters to one space's brain", () => {
    expect(boardGoals(lists, "home").map((goal) => goal.title)).toEqual(["Garden"]);
  });
});
