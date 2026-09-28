import { describe, expect, it } from "vite-plus/test";

import {
  ALL_SPACE_ID,
  initialSpaceState,
  OTHER_SPACE_ID,
  resolveProjectSpaces,
  seedProfileSpaces,
  type Space,
  type SpaceState,
} from "../../spaceStore";
import {
  spaceToggleEntries,
  threadSpaceBadges,
  toggleProjectInSpace,
} from "./spaceMembership.logic";

function custom(id: string, name: string): Space {
  return { id, name, color: "red", icon: { kind: "emoji", emoji: "🎵" }, profile: null };
}

function state(): SpaceState {
  const seeded = seedProfileSpaces(initialSpaceState, ["yu", "sn"]);
  return {
    ...seeded,
    spaces: [
      ...seeded.spaces.slice(0, -1),
      custom("music", "Music"),
      custom("games", "Games"),
      seeded.spaces.at(-1)!,
    ],
    detectedProfileByProjectKey: { "env:a": "yu", "env:b": null },
    customSpaceIdsByProjectKey: { "env:a": ["games"] },
  };
}

const yuId = (s: SpaceState) => s.spaces.find((space) => space.profile === "yu")!.id;

describe("threadSpaceBadges", () => {
  it("shows the profile space, then custom spaces, never All", () => {
    const s = state();
    const badges = threadSpaceBadges(s.spaces, resolveProjectSpaces(s, ["env:a"]));
    expect(badges.map((space) => space.id)).toEqual([yuId(s), "games"]);
  });

  it("shows Other for a project without a profile", () => {
    const s = state();
    const badges = threadSpaceBadges(s.spaces, resolveProjectSpaces(s, ["env:b"]));
    expect(badges.map((space) => space.id)).toEqual([OTHER_SPACE_ID]);
  });
});

describe("spaceToggleEntries", () => {
  it("lists the home space fixed, then custom spaces with their state", () => {
    const s = state();
    const entries = spaceToggleEntries(s.spaces, resolveProjectSpaces(s, ["env:a"]));
    expect(entries.map((entry) => [entry.space.id, entry.checked, entry.fixed])).toEqual([
      [yuId(s), true, true],
      ["music", false, false],
      ["games", true, false],
    ]);
  });

  it("never lists All, other profile spaces, or Other as toggles", () => {
    const s = state();
    const toggles = spaceToggleEntries(s.spaces, resolveProjectSpaces(s, ["env:b"])).filter(
      (entry) => !entry.fixed,
    );
    expect(toggles.map((entry) => entry.space.id)).toEqual(["music", "games"]);
  });
});

describe("toggleProjectInSpace", () => {
  it("adds every member key, then removes them again", () => {
    const added = toggleProjectInSpace(state(), ["env:a", "remote:a"], "music");
    expect(added.customSpaceIdsByProjectKey).toEqual({
      "env:a": ["games", "music"],
      "remote:a": ["music"],
    });
    expect(resolveProjectSpaces(added, ["env:a"]).homeSpaceId).toBe(yuId(added));
    const removed = toggleProjectInSpace(added, ["env:a", "remote:a"], "music");
    expect(removed.customSpaceIdsByProjectKey).toEqual({ "env:a": ["games"] });
  });

  it("removes a project already in the space", () => {
    const next = toggleProjectInSpace(state(), ["env:a"], "games");
    expect(next.customSpaceIdsByProjectKey).toEqual({});
  });

  it("leaves profile spaces, Other, All and unknown spaces alone", () => {
    const before = state();
    for (const target of [yuId(before), OTHER_SPACE_ID, ALL_SPACE_ID, "gone"]) {
      expect(toggleProjectInSpace(before, ["env:a"], target)).toBe(before);
    }
  });
});
