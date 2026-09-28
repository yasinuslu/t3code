// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { resolveCodeProfiles, resolveDefaultCodeProfile } from "./CodeProfiles.ts";

describe("resolveCodeProfiles", () => {
  let home: string;

  beforeEach(() => {
    home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "code-profiles-")),
    );
    const code = NodePath.join(home, "code");
    NodeFS.mkdirSync(NodePath.join(code, "work", "work-brain"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(code, "work", "github", "acme", "app"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(code, "me", "me-brain"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(code, "me", "github", "me", "dotfiles"), { recursive: true });
    // No `<name>-brain`: not a profile.
    NodeFS.mkdirSync(NodePath.join(code, "scratch", "tool"), { recursive: true });
    // A top-level symlink into a profile resolves to that profile.
    NodeFS.symlinkSync(
      NodePath.join(code, "me", "github", "me", "dotfiles"),
      NodePath.join(code, "dotfiles"),
    );
  });

  afterEach(() => {
    NodeFS.rmSync(home, { recursive: true, force: true });
  });

  it("lists profiles and assigns paths after resolving symlinks", async () => {
    const code = NodePath.join(home, "code");
    const result = await resolveCodeProfiles(
      {
        paths: [
          NodePath.join(code, "work", "github", "acme", "app"),
          NodePath.join(code, "dotfiles"),
          NodePath.join(code, "scratch", "tool"),
          NodePath.join(code, "work-other"),
          "/does/not/exist",
        ],
      },
      home,
    );
    expect(result.profiles.map((profile) => profile.name)).toEqual(["me", "work"]);
    expect(result.assignments.map((assignment) => assignment.profile)).toEqual([
      "work",
      "me",
      null,
      null,
      null,
    ]);
  });

  it("returns no profiles when the code directory is missing", async () => {
    const result = await resolveCodeProfiles({ paths: ["/tmp"] }, NodePath.join(home, "missing"));
    expect(result).toEqual({ profiles: [], assignments: [{ path: "/tmp", profile: null }] });
  });
});

describe("resolveDefaultCodeProfile", () => {
  let home: string;
  const profiles = () =>
    ["alpha", "work"].map((name) => ({ name, path: NodePath.join(home, "code", name) }));

  beforeEach(() => {
    home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "default-profile-")),
    );
    for (const name of ["alpha", "work"]) {
      NodeFS.mkdirSync(NodePath.join(home, "code", name, `${name}-brain`), { recursive: true });
    }
  });

  afterEach(() => {
    NodeFS.rmSync(home, { recursive: true, force: true });
  });

  it("picks the profile a top-level symlink points into", async () => {
    NodeFS.mkdirSync(NodePath.join(home, "code", "work", "config"));
    NodeFS.symlinkSync(
      NodePath.join(home, "code", "work", "config"),
      NodePath.join(home, "code", "config"),
    );
    expect(await resolveDefaultCodeProfile(profiles(), home)).toBe("work");
  });

  it("falls back to the first profile by name", async () => {
    expect(await resolveDefaultCodeProfile(profiles(), home)).toBe("alpha");
    expect(await resolveDefaultCodeProfile([], home)).toBeNull();
  });
});
