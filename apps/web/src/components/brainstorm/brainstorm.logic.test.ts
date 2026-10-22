import type { BrainstormTaskList, EnvironmentId, ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ALL_SPACE_ID, initialSpaceState, type Space } from "../../spaceStore";
import {
  brainstormSpacesInput,
  adjacentManagerProfileChoice,
  MANAGER_PROFILE_ALL,
  managerProfileChoices,
  membershipChangesToAdopt,
  resolveManagerEnvironmentId,
  resolveManagerEnvironmentIds,
  resolveManagerHostIds,
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

  it("lists every machine that runs a profile's own manager and opens the one picked", () => {
    const both = configs({ laptop: ["sn", "yu"], desktop: ["yu"] });
    expect(resolveManagerHostIds(desktop, both, "yu")).toEqual([desktop, laptop]);
    expect(resolveManagerEnvironmentId(desktop, both, "yu")).toBe(desktop);
    expect(resolveManagerEnvironmentId(desktop, both, "yu", laptop)).toBe(laptop);
    // A pick that does not host this profile falls back to its first host.
    expect(resolveManagerEnvironmentId(desktop, both, "sn", desktop)).toBe(laptop);
  });

  it("shows a reachable machine while the pick is offline, and the pick once it is back", () => {
    // Offline machines keep their last config, so the pick is still a host.
    const both = configs({ laptop: ["yu"], desktop: ["yu"] });
    const laptopOffline = (id: EnvironmentId) => id !== laptop;
    expect(resolveManagerEnvironmentId(desktop, both, "yu", laptop)).toBe(laptop);
    expect(resolveManagerEnvironmentId(desktop, both, "yu", laptop, laptopOffline)).toBe(desktop);
    // With nothing reachable the pick stays, and Home says it is offline.
    expect(resolveManagerEnvironmentId(desktop, both, "yu", laptop, () => false)).toBe(laptop);
    expect(resolveManagerEnvironmentId(desktop, configs({ desktop: ["yu"] }), "yu", laptop)).toBe(
      desktop,
    );
  });

  it("defaults to the always-on host over the primary, while it can be reached", () => {
    const nika = "nika" as EnvironmentId;
    const split = new Map([
      ...configs({ laptop: ["sn", "yu"] }),
      [
        nika,
        { settings: { hostsManager: true, managerProfiles: ["yu"] } } as unknown as ServerConfig,
      ],
    ]);
    expect(resolveManagerHostIds(laptop, split, "yu")).toEqual([nika, laptop]);
    expect(resolveManagerEnvironmentId(laptop, split, "yu")).toBe(nika);
    expect(resolveManagerEnvironmentId(laptop, split, "yu", null, (id) => id !== nika)).toBe(
      laptop,
    );
    // A pick still wins.
    expect(resolveManagerEnvironmentId(laptop, split, "yu", laptop)).toBe(laptop);
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

describe("adjacentManagerProfileChoice", () => {
  const choices = managerProfileChoices(["yu", "sn"], true);
  it("lists All last, and only when offered", () => {
    expect(choices).toEqual(["yu", "sn", MANAGER_PROFILE_ALL]);
    expect(managerProfileChoices(["yu", "sn"], false)).toEqual(["yu", "sn"]);
  });
  it("steps in switcher order and wraps at both ends", () => {
    expect(adjacentManagerProfileChoice(choices, "yu", 1)).toBe("sn");
    expect(adjacentManagerProfileChoice(choices, "sn", 1)).toBe(MANAGER_PROFILE_ALL);
    expect(adjacentManagerProfileChoice(choices, MANAGER_PROFILE_ALL, 1)).toBe("yu");
    expect(adjacentManagerProfileChoice(choices, "yu", -1)).toBe(MANAGER_PROFILE_ALL);
  });
  it("enters the list from either end when nothing is selected", () => {
    expect(adjacentManagerProfileChoice(choices, null, 1)).toBe("yu");
    expect(adjacentManagerProfileChoice(choices, null, -1)).toBe(MANAGER_PROFILE_ALL);
  });
  it("does nothing with a single segment", () => {
    expect(adjacentManagerProfileChoice(["yu"], "yu", 1)).toBeNull();
  });
});
