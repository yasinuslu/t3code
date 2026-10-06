import type { BrainstormTaskList } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ALL_SPACE_ID, initialSpaceState, type Space } from "../../spaceStore";
import { boardGoals, brainstormSpacesInput, membershipChangesToAdopt } from "./brainstorm.logic";

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

describe("boardGoals", () => {
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
