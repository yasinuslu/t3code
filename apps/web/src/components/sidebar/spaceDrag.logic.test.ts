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
import { applySpaceDrop, spaceDropTargets, threadSpaceBadges } from "./spaceDrag.logic";

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
    expect(badges.map((space) => space.id)).not.toContain(ALL_SPACE_ID);
  });

  it("shows Other for a project without a profile", () => {
    const s = state();
    const badges = threadSpaceBadges(s.spaces, resolveProjectSpaces(s, ["env:b"]));
    expect(badges.map((space) => space.id)).toEqual([OTHER_SPACE_ID]);
  });
});

describe("spaceDropTargets", () => {
  it("lists only custom spaces and marks the ones the project is in", () => {
    const s = state();
    const targets = spaceDropTargets(s.spaces, resolveProjectSpaces(s, ["env:a"]));
    expect(targets.map((target) => [target.space.id, target.isMember])).toEqual([
      ["music", false],
      ["games", true],
    ]);
  });

  it("is empty without custom spaces", () => {
    const s = seedProfileSpaces(initialSpaceState, ["yu"]);
    expect(spaceDropTargets(s.spaces, resolveProjectSpaces(s, ["env:a"]))).toEqual([]);
  });
});

describe("applySpaceDrop", () => {
  it("adds every member key of the project to the custom space", () => {
    const { state: next, outcome } = applySpaceDrop(state(), ["env:a", "remote:a"], "music");
    expect(outcome).toBe("added");
    expect(next.customSpaceIdsByProjectKey).toEqual({
      "env:a": ["games", "music"],
      "remote:a": ["music"],
    });
    // Overlay: still in its profile space.
    expect(resolveProjectSpaces(next, ["env:a"]).homeSpaceId).toBe(yuId(next));
  });

  it("leaves a project that is already in the space alone", () => {
    const before = state();
    const { state: next, outcome } = applySpaceDrop(before, ["env:a"], "games");
    expect(outcome).toBe("already-member");
    expect(next).toBe(before);
  });

  it("rejects profile spaces, Other, All and unknown spaces", () => {
    const before = state();
    for (const target of [yuId(before), OTHER_SPACE_ID, ALL_SPACE_ID, "gone"]) {
      const { state: next, outcome } = applySpaceDrop(before, ["env:a"], target);
      expect(outcome).toBe("rejected");
      expect(next).toBe(before);
    }
  });
});
