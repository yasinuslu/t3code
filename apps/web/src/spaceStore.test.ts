import { describe, expect, it } from "vite-plus/test";

import {
  adjacentSpaceId,
  ALL_SPACE_ID,
  createSpaceSwipeTracker,
  initialSpaceState,
  OTHER_SPACE_ID,
  parsePersistedSpaceState,
  removeSpace,
  resolveProjectGroupSpaceId,
  resolveProjectSpaceId,
  seedProfileSpaces,
  type SpaceState,
} from "./spaceStore";

function seeded(): SpaceState {
  return seedProfileSpaces(initialSpaceState, ["work", "me"]);
}

describe("seedProfileSpaces", () => {
  it("adds one space per new profile between All and Other", () => {
    const state = seeded();
    expect(state.spaces.map((space) => space.name)).toEqual(["All", "work", "me", "Other"]);
    expect(state.spaces.map((space) => space.profile)).toEqual([null, "work", "me", null]);
  });

  it("does not bring back a deleted profile space", () => {
    const state = seeded();
    const work = state.spaces.find((space) => space.profile === "work")!;
    const afterDelete = seedProfileSpaces(removeSpace(state, work.id), ["work", "me"]);
    expect(afterDelete.spaces.map((space) => space.name)).toEqual(["All", "me", "Other"]);
  });
});

describe("resolveProjectSpaceId", () => {
  it("prefers the user's placement, then the profile, then Other", () => {
    const state = seeded();
    const work = state.spaces.find((space) => space.profile === "work")!;
    const me = state.spaces.find((space) => space.profile === "me")!;
    const withData: SpaceState = {
      ...state,
      detectedProfileByProjectKey: { "env:a": "work", "env:b": "work", "env:c": null },
      projectSpaceByKey: { "env:b": me.id },
    };
    expect(resolveProjectSpaceId(withData, "env:a")).toBe(work.id);
    expect(resolveProjectSpaceId(withData, "env:b")).toBe(me.id);
    expect(resolveProjectSpaceId(withData, "env:c")).toBe(OTHER_SPACE_ID);
    expect(resolveProjectSpaceId(withData, "env:unknown")).toBe(OTHER_SPACE_ID);
  });

  it("falls back to the default when the placed space is deleted", () => {
    const state = seeded();
    const work = state.spaces.find((space) => space.profile === "work")!;
    const me = state.spaces.find((space) => space.profile === "me")!;
    const placed: SpaceState = {
      ...state,
      detectedProfileByProjectKey: { "env:a": "work" },
      projectSpaceByKey: { "env:a": me.id },
    };
    expect(resolveProjectSpaceId(removeSpace(placed, me.id), "env:a")).toBe(work.id);
  });
});

describe("removeSpace", () => {
  it("keeps the built-in spaces and leaves a deleted active space for All", () => {
    const state = seeded();
    const work = state.spaces.find((space) => space.profile === "work")!;
    expect(removeSpace(state, ALL_SPACE_ID)).toBe(state);
    expect(removeSpace(state, OTHER_SPACE_ID)).toBe(state);
    expect(removeSpace({ ...state, activeSpaceId: work.id }, work.id).activeSpaceId).toBe(
      ALL_SPACE_ID,
    );
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
      lastRouteBySpaceId: { s1: { kind: "draft", draftId: "d1" }, s2: { kind: "nope" } },
    });
    expect(parsed.spaces.map((space) => space.id)).toEqual([ALL_SPACE_ID, "s1", OTHER_SPACE_ID]);
    expect(parsed.activeSpaceId).toBe(ALL_SPACE_ID);
    expect(parsed.lastRouteBySpaceId).toEqual({ s1: { kind: "draft", draftId: "d1" } });
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

describe("resolveProjectGroupSpaceId", () => {
  // Regression: a group whose first member had no detected profile (a folder
  // outside every profile, or an environment that cannot report one) sent the
  // whole group, and every thread in it, to Other.
  it("places a group by any member with a profile, not only the first", () => {
    const state = seeded();
    const me = state.spaces.find((space) => space.profile === "me")!;
    const withData: SpaceState = {
      ...state,
      detectedProfileByProjectKey: { "remote:a": null, "local:a": "me" },
    };
    expect(resolveProjectGroupSpaceId(withData, ["remote:a", "local:a"])).toBe(me.id);
    expect(resolveProjectGroupSpaceId(withData, ["remote:unknown", "local:a"])).toBe(me.id);
    expect(resolveProjectGroupSpaceId(withData, ["remote:a"])).toBe(OTHER_SPACE_ID);
  });

  it("lets a placed member win over detected profiles", () => {
    const state = seeded();
    const work = state.spaces.find((space) => space.profile === "work")!;
    const withData: SpaceState = {
      ...state,
      detectedProfileByProjectKey: { "local:a": "me" },
      projectSpaceByKey: { "remote:a": work.id },
    };
    expect(resolveProjectGroupSpaceId(withData, ["local:a", "remote:a"])).toBe(work.id);
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
