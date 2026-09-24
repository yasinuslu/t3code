import { describe, expect, it } from "vite-plus/test";

import { resolveGitTargetRepositorySelection } from "./gitTargetRepositorySelection";

const ROOT_CWD = "/repo";
const SUBMODULE_A = { path: "vendor/a", cwd: "/repo/vendor/a", hasChanges: false };
const SUBMODULE_B = { path: "vendor/b", cwd: "/repo/vendor/b", hasChanges: true };

describe("resolveGitTargetRepositorySelection", () => {
  it("targets the root when nothing is selected", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: ROOT_CWD,
      rootHasWorkingTreeChanges: false,
      submodules: [SUBMODULE_A, SUBMODULE_B],
      selectedPath: null,
    });

    expect(result.targetCwd).toBe(ROOT_CWD);
    expect(result.selectedPath).toBeNull();
    expect(result.shouldResetSelection).toBe(false);
  });

  it("lists root first, then submodules, carrying each option's hasChanges", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: ROOT_CWD,
      rootHasWorkingTreeChanges: true,
      submodules: [SUBMODULE_A, SUBMODULE_B],
      selectedPath: null,
    });

    expect(result.hasSubmodules).toBe(true);
    expect(result.options).toEqual([
      { path: null, cwd: ROOT_CWD, hasChanges: true },
      { path: SUBMODULE_A.path, cwd: SUBMODULE_A.cwd, hasChanges: false },
      { path: SUBMODULE_B.path, cwd: SUBMODULE_B.cwd, hasChanges: true },
    ]);
  });

  it("resolves the target cwd to the selected submodule when it is still present", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: ROOT_CWD,
      rootHasWorkingTreeChanges: false,
      submodules: [SUBMODULE_A, SUBMODULE_B],
      selectedPath: SUBMODULE_B.path,
    });

    expect(result.targetCwd).toBe(SUBMODULE_B.cwd);
    expect(result.selectedPath).toBe(SUBMODULE_B.path);
    expect(result.shouldResetSelection).toBe(false);
  });

  it("falls back to root and signals a reset once a selected submodule disappears", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: ROOT_CWD,
      rootHasWorkingTreeChanges: false,
      submodules: [SUBMODULE_A],
      selectedPath: SUBMODULE_B.path,
    });

    expect(result.targetCwd).toBe(ROOT_CWD);
    expect(result.selectedPath).toBeNull();
    expect(result.shouldResetSelection).toBe(true);
  });

  it("does not reset a selection while the root status has not loaded yet", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: ROOT_CWD,
      rootHasWorkingTreeChanges: false,
      submodules: null,
      selectedPath: SUBMODULE_B.path,
    });

    // Submodules are unknown (root status still loading), so the previous
    // selection must not be treated as gone — that would flash back to root
    // on every remount before the first status response arrives.
    expect(result.shouldResetSelection).toBe(false);
    // The target cwd still falls back to root until the submodule is
    // confirmed to exist, so no RPC targets a path that may not resolve.
    expect(result.targetCwd).toBe(ROOT_CWD);
  });

  it("has no options when the root cwd is unknown", () => {
    const result = resolveGitTargetRepositorySelection({
      rootCwd: null,
      rootHasWorkingTreeChanges: false,
      submodules: null,
      selectedPath: null,
    });

    expect(result.options).toEqual([]);
    expect(result.targetCwd).toBeNull();
  });
});
