import { describe, expect, it } from "vite-plus/test";

import {
  adjacentSpaceId,
  ALL_SPACE_ID,
  createSpaceSwipeTracker,
  initialSpaceState,
  isCustomSpace,
  isDeletableSpace,
  isInSpace,
  migrateSpaceStateFromV1,
  OTHER_SPACE_ID,
  parsePersistedSpaceState,
  removeSpace,
  resolveProjectSpaces,
  seedProfileSpaces,
  setProjectsInCustomSpace,
  type Space,
  type SpaceState,
} from "./spaceStore";

function seeded(): SpaceState {
  return seedProfileSpaces(initialSpaceState, ["work", "me"]);
}

function profileSpace(state: SpaceState, profile: string): Space {
  return state.spaces.find((space) => space.profile === profile)!;
}

function customSpace(id: string, name: string): Space {
  return { id, name, color: "red", icon: { kind: "emoji", emoji: "🎵" }, profile: null };
}

/** Seeded work/me profile spaces plus a custom "Music" space. */
function withMusic(): SpaceState {
  const state = seeded();
  return {
    ...state,
    spaces: [...state.spaces.slice(0, -1), customSpace("music", "Music"), state.spaces.at(-1)!],
    detectedProfileByProjectKey: { "env:a": "work", "env:b": "me", "env:c": null },
  };
}

/** Ids of the spaces a project shows in, besides All. */
function shownIn(state: SpaceState, memberKeys: ReadonlyArray<string>): string[] {
  const spaces = resolveProjectSpaces(state, memberKeys);
  return state.spaces
    .filter((space) => space.id !== ALL_SPACE_ID && isInSpace(spaces, space.id))
    .map((space) => space.id);
}

describe("seedProfileSpaces", () => {
  it("adds one space per new profile between All and Other", () => {
    const state = seeded();
    expect(state.spaces.map((space) => space.name)).toEqual(["All", "work", "me", "Other"]);
    expect(state.spaces.map((space) => space.profile)).toEqual([null, "work", "me", null]);
  });

  it("does not add a second space for a profile that already has one", () => {
    const state = seeded();
    expect(seedProfileSpaces(state, ["work", "me", "work"])).toBe(state);
  });
});

describe("space kinds", () => {
  it("only custom spaces are custom and deletable", () => {
    const state = withMusic();
    const kinds = state.spaces.map((space) => [
      space.name,
      isCustomSpace(space),
      isDeletableSpace(space),
    ]);
    expect(kinds).toEqual([
      ["All", false, false],
      ["work", false, false],
      ["me", false, false],
      ["Music", true, true],
      ["Other", false, false],
    ]);
  });
});

describe("resolveProjectSpaces", () => {
  it("puts a project in its profile space, else Other", () => {
    const state = withMusic();
    expect(resolveProjectSpaces(state, ["env:a"]).homeSpaceId).toBe(profileSpace(state, "work").id);
    expect(resolveProjectSpaces(state, ["env:b"]).homeSpaceId).toBe(profileSpace(state, "me").id);
    expect(resolveProjectSpaces(state, ["env:c"]).homeSpaceId).toBe(OTHER_SPACE_ID);
    expect(resolveProjectSpaces(state, ["env:unknown"]).homeSpaceId).toBe(OTHER_SPACE_ID);
  });

  // Regression: a group whose first member had no detected profile (a folder
  // outside every profile, or an environment that cannot report one) sent the
  // whole group, and every thread in it, to Other.
  it("places a group by any member with a profile, not only the first", () => {
    const state = seeded();
    const me = profileSpace(state, "me");
    const withData: SpaceState = {
      ...state,
      detectedProfileByProjectKey: { "remote:a": null, "local:a": "me" },
    };
    expect(resolveProjectSpaces(withData, ["remote:a", "local:a"]).homeSpaceId).toBe(me.id);
    expect(resolveProjectSpaces(withData, ["remote:unknown", "local:a"]).homeSpaceId).toBe(me.id);
    expect(resolveProjectSpaces(withData, ["remote:a"]).homeSpaceId).toBe(OTHER_SPACE_ID);
  });

  it("counts a custom membership of any group member for the group", () => {
    const state = setProjectsInCustomSpace(withMusic(), ["remote:a"], "music", true);
    expect(resolveProjectSpaces(state, ["env:a", "remote:a"]).customSpaceIds).toEqual(["music"]);
  });

  it("ignores memberships of spaces that no longer exist", () => {
    const state: SpaceState = {
      ...withMusic(),
      customSpaceIdsByProjectKey: { "env:a": ["gone", "music"] },
    };
    expect(resolveProjectSpaces(state, ["env:a"]).customSpaceIds).toEqual(["music"]);
  });
});

describe("custom space membership", () => {
  it("shows a project in its profile space and every custom space it was added to", () => {
    const state = setProjectsInCustomSpace(withMusic(), ["env:a"], "music", true);
    const work = profileSpace(state, "work");
    expect(shownIn(state, ["env:a"])).toEqual([work.id, "music"]);
    // Still shown in All, and nowhere it was not added.
    expect(isInSpace(resolveProjectSpaces(state, ["env:a"]), ALL_SPACE_ID)).toBe(true);
    expect(shownIn(state, ["env:b"])).toEqual([profileSpace(state, "me").id]);
  });

  it("keeps a project without a profile in Other while it is in a custom space", () => {
    const state = setProjectsInCustomSpace(withMusic(), ["env:c"], "music", true);
    expect(shownIn(state, ["env:c"])).toEqual(["music", OTHER_SPACE_ID]);
  });

  it("lets a project be in several custom spaces and removes one at a time", () => {
    const base = withMusic();
    const twoCustom: SpaceState = {
      ...base,
      spaces: [...base.spaces.slice(0, -1), customSpace("games", "Games"), base.spaces.at(-1)!],
    };
    const added = setProjectsInCustomSpace(
      setProjectsInCustomSpace(twoCustom, ["env:a"], "music", true),
      ["env:a"],
      "games",
      true,
    );
    expect(resolveProjectSpaces(added, ["env:a"]).customSpaceIds).toEqual(["music", "games"]);
    const removed = setProjectsInCustomSpace(added, ["env:a"], "music", false);
    expect(resolveProjectSpaces(removed, ["env:a"]).customSpaceIds).toEqual(["games"]);
    const empty = setProjectsInCustomSpace(removed, ["env:a"], "games", false);
    expect(empty.customSpaceIdsByProjectKey).toEqual({});
    expect(shownIn(empty, ["env:a"])).toEqual([profileSpace(empty, "work").id]);
  });

  it("adding twice does not duplicate the membership", () => {
    const once = setProjectsInCustomSpace(withMusic(), ["env:a"], "music", true);
    const twice = setProjectsInCustomSpace(once, ["env:a"], "music", true);
    expect(twice.customSpaceIdsByProjectKey).toEqual({ "env:a": ["music"] });
  });

  it("does not accept profile spaces, Other or All as targets", () => {
    const state = withMusic();
    for (const target of [profileSpace(state, "me").id, OTHER_SPACE_ID, ALL_SPACE_ID, "gone"]) {
      expect(setProjectsInCustomSpace(state, ["env:a"], target, true)).toBe(state);
      expect(setProjectsInCustomSpace(state, ["env:a"], target, false)).toBe(state);
    }
    // A project cannot be taken out of its profile space.
    expect(shownIn(state, ["env:a"])).toEqual([profileSpace(state, "work").id]);
  });
});

describe("removeSpace", () => {
  it("keeps built-in and profile spaces", () => {
    const state = withMusic();
    expect(removeSpace(state, ALL_SPACE_ID)).toBe(state);
    expect(removeSpace(state, OTHER_SPACE_ID)).toBe(state);
    expect(removeSpace(state, profileSpace(state, "work").id)).toBe(state);
  });

  it("deletes a custom space and only its memberships", () => {
    const base = withMusic();
    const state: SpaceState = {
      ...base,
      spaces: [...base.spaces.slice(0, -1), customSpace("games", "Games"), base.spaces.at(-1)!],
      activeSpaceId: "music",
      customSpaceIdsByProjectKey: { "env:a": ["music", "games"], "env:b": ["music"] },
      lastRouteBySpaceId: { music: { kind: "draft", draftId: "d1" } },
    };
    const removed = removeSpace(state, "music");
    expect(removed.spaces.map((space) => space.id)).not.toContain("music");
    expect(removed.activeSpaceId).toBe(ALL_SPACE_ID);
    expect(removed.customSpaceIdsByProjectKey).toEqual({ "env:a": ["games"] });
    expect(removed.lastRouteBySpaceId).toEqual({});
    expect(shownIn(removed, ["env:b"])).toEqual([profileSpace(removed, "me").id]);
  });
});

describe("parsePersistedSpaceState", () => {
  it("restores built-ins around saved spaces and drops invalid entries", () => {
    const parsed = parsePersistedSpaceState({
      spaces: [
        { id: "s1", name: "Games", color: "red", icon: { kind: "emoji", emoji: "🎮" } },
        { id: "bad", name: "", icon: null },
      ],
      activeSpaceId: "missing",
      customSpaceIdsByProjectKey: { "env:a": ["s1"], "env:b": "s1" },
      lastRouteBySpaceId: { s1: { kind: "draft", draftId: "d1" }, s2: { kind: "nope" } },
    });
    expect(parsed.spaces.map((space) => space.id)).toEqual([ALL_SPACE_ID, "s1", OTHER_SPACE_ID]);
    expect(parsed.activeSpaceId).toBe(ALL_SPACE_ID);
    expect(parsed.customSpaceIdsByProjectKey).toEqual({ "env:a": ["s1"] });
    expect(parsed.lastRouteBySpaceId).toEqual({ s1: { kind: "draft", draftId: "d1" } });
  });
});

describe("migrateSpaceStateFromV1", () => {
  const v1 = {
    spaces: [
      {
        id: "p-work",
        name: "work",
        color: "blue",
        icon: { kind: "emoji", emoji: "💼" },
        profile: "work",
      },
      { id: "music", name: "Music", color: "red", icon: { kind: "emoji", emoji: "🎵" } },
    ],
    activeSpaceId: "music",
    seededProfiles: ["work", "me"],
    projectSpaceByKey: {
      "env:a": "music",
      "env:b": "p-work",
      "env:c": OTHER_SPACE_ID,
      "env:d": ALL_SPACE_ID,
      "env:e": "deleted-space",
    },
    detectedProfileByProjectKey: { "env:a": "work", "env:b": "me" },
  };

  it("turns custom-space placements into memberships and drops the rest", () => {
    const migrated = parsePersistedSpaceState(migrateSpaceStateFromV1(v1));
    expect(migrated.customSpaceIdsByProjectKey).toEqual({ "env:a": ["music"] });
    expect(migrated.activeSpaceId).toBe("music");
    expect(migrated.detectedProfileByProjectKey).toEqual(v1.detectedProfileByProjectKey);
    expect(migrated).not.toHaveProperty("projectSpaceByKey");
    expect(migrated).not.toHaveProperty("seededProfiles");
  });

  it("puts a project placed in another profile space back in its own", () => {
    const migrated = seedProfileSpaces(parsePersistedSpaceState(migrateSpaceStateFromV1(v1)), [
      "work",
      "me",
    ]);
    // env:b was placed in work but lives in me: me is re-seeded and owns it.
    expect(shownIn(migrated, ["env:b"])).toEqual([profileSpace(migrated, "me").id]);
    // env:a stays in work and keeps Music.
    expect(shownIn(migrated, ["env:a"])).toEqual(["p-work", "music"]);
  });
});

describe("createSpaceSwipeTracker", () => {
  it("steps once per horizontal gesture and ignores vertical scrolling", () => {
    const track = createSpaceSwipeTracker();
    expect(track({ deltaX: 0, deltaY: 40, timeStamp: 0 })).toBeNull();
    expect(track({ deltaX: 50, deltaY: 2, timeStamp: 16 })).toBeNull();
    expect(track({ deltaX: 50, deltaY: 2, timeStamp: 32 })).toBe(1);
    // Momentum from the same gesture does not step again.
    expect(track({ deltaX: 200, deltaY: 0, timeStamp: 48 })).toBeNull();
    // A new gesture after a pause steps the other way.
    expect(track({ deltaX: -120, deltaY: 0, timeStamp: 1_000 })).toBe(-1);
  });
});

describe("adjacentSpaceId", () => {
  const spaces = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("steps between neighbours", () => {
    expect(adjacentSpaceId(spaces, "b", 1)).toBe("c");
    expect(adjacentSpaceId(spaces, "b", -1)).toBe("a");
  });

  it("wraps around at both ends", () => {
    expect(adjacentSpaceId(spaces, "c", 1)).toBe("a");
    expect(adjacentSpaceId(spaces, "a", -1)).toBe("c");
  });

  it("has no neighbour with a single space", () => {
    expect(adjacentSpaceId([{ id: "a" }], "a", 1)).toBeNull();
  });
});
