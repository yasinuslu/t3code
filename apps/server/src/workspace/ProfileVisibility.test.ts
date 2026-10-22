// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  isProfileVisible,
  makeShellItemFilter,
  ProfileVisibility,
  resolveProjectProfiles,
} from "./ProfileVisibility.ts";

describe("resolveProjectProfiles", () => {
  let home: string;
  const at = (...parts: string[]) => NodePath.join(home, "code", ...parts);

  beforeEach(() => {
    home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "profile-vis-")));
    for (const dir of [
      ["yu", "yu-brain"],
      ["yu", "github", "me", "t3code"],
      ["yu", "github", "me", "risale"],
      ["sn", "sn-brain"],
      ["sn", "github", "me", "device-queue"],
      ["sn", "work"],
    ]) {
      NodeFS.mkdirSync(at(...dir), { recursive: true });
    }
  });

  afterEach(() => {
    NodeFS.rmSync(home, { recursive: true, force: true });
  });

  it("puts a project in its path's profile unless a folder override names another", async () => {
    const profiles = await resolveProjectProfiles(
      [
        at("yu", "github", "me", "t3code"),
        at("yu", "github", "me", "risale"),
        at("sn", "work"),
        at("sn", "github", "me", "device-queue"),
        NodePath.join(home, "elsewhere"),
      ],
      {
        "~/code/yu/github/me/t3code": "common",
        [at("sn", "github", "me")]: "common",
      },
      home,
    );
    expect(profiles).toEqual(["common", "yu", "sn", "common", null]);
  });

  it("lets the deepest override win", async () => {
    const profiles = await resolveProjectProfiles(
      [at("sn", "github", "me", "device-queue")],
      { "~/code/sn/github": "common", "~/code/sn/github/me/device-queue": "yu" },
      home,
    );
    expect(profiles).toEqual(["yu"]);
  });
});

describe("isProfileVisible", () => {
  it("shows a locked client its own, common and unassigned projects only", () => {
    expect(isProfileVisible("sn", "sn")).toBe(true);
    expect(isProfileVisible("common", "sn")).toBe(true);
    expect(isProfileVisible(null, "sn")).toBe(true);
    expect(isProfileVisible("yu", "sn")).toBe(false);
    expect(isProfileVisible("yu", null)).toBe(true);
  });
});

describe("makeShellItemFilter", () => {
  const projects = [
    { id: "p-sn", workspaceRoot: "/sn" },
    { id: "p-yu", workspaceRoot: "/yu" },
  ];
  const visibility = ProfileVisibility.of({
    profilesOf: (list) =>
      Effect.succeed(new Map(list.map((project) => [project.id, project.id.slice(2)]))),
    visibleProjectIds: (lock, list) =>
      Effect.succeed(
        new Set(
          list.filter((project) => lock === null || project.id === `p-${lock}`).map((p) => p.id),
        ),
      ),
  });
  const filterFor = (lock: string | null) =>
    makeShellItemFilter(lock, (projectId) =>
      Effect.succeed(projects.find((project) => project.id === projectId) ?? null),
    ).pipe(Effect.provideService(ProfileVisibility, visibility));

  it.effect("drops another profile's projects and threads from a snapshot", () =>
    Effect.gen(function* () {
      const filter = yield* filterFor("sn");
      const snapshot = yield* filter.filterSnapshot({
        projects,
        threads: [
          { id: "t1", projectId: "p-sn" },
          { id: "t2", projectId: "p-yu" },
        ],
        archivedThreads: [{ id: "t3", projectId: "p-yu" }],
      });
      expect(snapshot.projects.map((project) => project.id)).toEqual(["p-sn"]);
      expect(snapshot.threads.map((thread) => thread.id)).toEqual(["t1"]);
      expect(snapshot.archivedThreads).toEqual([]);
    }),
  );

  it.effect("turns updates of hidden projects and threads into removals", () =>
    Effect.gen(function* () {
      const filter = yield* filterFor("sn");
      expect(
        yield* filter.filterItem({
          kind: "thread.updated",
          sequence: 4,
          location: "active",
          thread: { id: "t2", projectId: "p-yu" },
        }),
      ).toEqual({ kind: "thread.removed", sequence: 4, location: "active", threadId: "t2" });
      expect(
        yield* filter.filterItem({ kind: "project.updated", sequence: 5, project: projects[1]! }),
      ).toEqual({ kind: "project.removed", sequence: 5, projectId: "p-yu" });
      const kept = { kind: "thread.updated", sequence: 6, thread: { id: "t1", projectId: "p-sn" } };
      expect(yield* filter.filterItem(kept as never)).toBe(kept);
    }),
  );

  it.effect("passes everything through without a lock", () =>
    Effect.gen(function* () {
      const filter = yield* filterFor(null);
      const item = { kind: "thread.updated", sequence: 1, thread: { id: "t2", projectId: "p-yu" } };
      expect(yield* filter.filterItem(item as never)).toBe(item);
    }),
  );
});
