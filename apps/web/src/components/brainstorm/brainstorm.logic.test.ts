import type { BrainstormTaskList, EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ALL_SPACE_ID, initialSpaceState, type Space } from "../../spaceStore";
import {
  boardGoals,
  brainstormSpacesInput,
  goalsOfSpace,
  membershipChangesToAdopt,
  resolveManagerEnvironmentId,
  resolveManagerEnvironmentIds,
  resolveManagerProfile,
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

describe("resolveManagerEnvironmentId", () => {
  const laptop = "laptop" as EnvironmentId;
  const desktop = "desktop" as EnvironmentId;
  const configs = (hosts: Record<string, boolean | ReadonlyArray<string>>) =>
    new Map(
      Object.entries(hosts).map(([id, host]) => [
        id as EnvironmentId,
        {
          settings:
            typeof host === "boolean"
              ? { hostsManager: host, managerProfiles: [] }
              : { hostsManager: false, managerProfiles: host },
        } as unknown as ServerConfig,
      ]),
    );

  it("opens the manager on a connected machine that hosts it", () => {
    expect(resolveManagerEnvironmentId(laptop, configs({ laptop: false, desktop: true }))).toBe(
      desktop,
    );
  });

  it("prefers the primary environment when it hosts the manager too", () => {
    expect(resolveManagerEnvironmentId(laptop, configs({ desktop: true, laptop: true }))).toBe(
      laptop,
    );
  });

  it("falls back to the primary environment when no machine hosts it", () => {
    expect(resolveManagerEnvironmentId(laptop, configs({ laptop: false, desktop: false }))).toBe(
      laptop,
    );
    expect(resolveManagerEnvironmentId(null, configs({}))).toBe(null);
  });

  it("opens a profile's manager on the machine that names it, even over the primary", () => {
    const split = configs({ laptop: ["sn"], desktop: true });
    expect(resolveManagerEnvironmentId(desktop, split, "sn")).toBe(laptop);
    expect(resolveManagerEnvironmentId(desktop, split, "yu")).toBe(desktop);
    expect(resolveManagerEnvironmentId(laptop, split, "yu")).toBe(desktop);
  });

  it("starts no second copy when a split profile's machine is not connected", () => {
    const desktopOnly = configs({ desktop: ["yu"] });
    expect(resolveManagerEnvironmentId(desktop, desktopOnly, "yu")).toBe(desktop);
    expect(resolveManagerEnvironmentId(desktop, desktopOnly, "sn")).toBe(null);
  });

  it("lists every machine that runs a manager", () => {
    expect(
      resolveManagerEnvironmentIds(desktop, configs({ laptop: ["sn"], desktop: ["yu"] })),
    ).toEqual([laptop, desktop]);
    expect(resolveManagerEnvironmentIds(laptop, configs({ laptop: false }))).toEqual([laptop]);
  });
});

describe("resolveManagerProfile", () => {
  const profiles = ["sn", "yu"];
  it("follows the active profile space, then the last pick, then the server's default", () => {
    const base = {
      profiles,
      activeSpaceProfile: null,
      lastManagerProfile: null,
      serverDefaultProfile: "yu",
    };
    expect(resolveManagerProfile({ ...base, activeSpaceProfile: "sn" })).toBe("sn");
    expect(resolveManagerProfile({ ...base, lastManagerProfile: "sn" })).toBe("sn");
    expect(resolveManagerProfile(base)).toBe("yu");
    // A profile that lost its brain is skipped.
    expect(resolveManagerProfile({ ...base, activeSpaceProfile: "gone" })).toBe("yu");
    expect(resolveManagerProfile({ ...base, serverDefaultProfile: null })).toBe("sn");
  });

  it("is null when no profile has a brain", () => {
    expect(
      resolveManagerProfile({
        profiles: [],
        activeSpaceProfile: "yu",
        lastManagerProfile: "yu",
        serverDefaultProfile: null,
      }),
    ).toBeNull();
  });
});

describe("goalsOfSpace", () => {
  const list = (spaceId: string, profile: string | null, goal: string): BrainstormTaskList => ({
    spaceId,
    spaceName: spaceId,
    path: null,
    profile,
    goals: [{ number: 1, title: goal, done: false, notes: [] }],
    tasks: [],
  });
  const lists = [list("server-yu", "yu", "Personal"), list("server-sn", "sn", "Work")];
  it("matches a profile space by profile, whatever id the server gave it", () => {
    const titles = (space: { id: string; profile: string | null } | null) =>
      goalsOfSpace(lists, space).map((goal) => goal.title);
    expect(titles({ id: "client-sn", profile: "sn" })).toEqual(["Work"]);
    expect(titles({ id: ALL_SPACE_ID, profile: null })).toEqual(["Personal", "Work"]);
    expect(titles(null)).toEqual(["Personal", "Work"]);
  });
});
