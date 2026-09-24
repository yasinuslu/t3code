import type { VcsStatusSubmodule } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveGitRepoTarget,
  shouldResetGitRepoSelection,
  toRootRepoPath,
} from "./gitRepoTargetStore";

const ROOT = "/repo";
const LIB: VcsStatusSubmodule = { path: "vendor/lib", cwd: "/repo/vendor/lib", hasChanges: true };
const NESTED: VcsStatusSubmodule = {
  path: "vendor/lib/deps/core",
  cwd: "/repo/vendor/lib/deps/core",
  hasChanges: false,
};

describe("resolveGitRepoTarget", () => {
  it("targets the root repo without a selection", () => {
    expect(resolveGitRepoTarget({ rootCwd: ROOT, submodules: [LIB], selectedPath: null })).toEqual({
      cwd: ROOT,
      submodule: null,
    });
  });

  it("targets a selected submodule, nested ones included", () => {
    expect(
      resolveGitRepoTarget({ rootCwd: ROOT, submodules: [LIB, NESTED], selectedPath: NESTED.path }),
    ).toEqual({ cwd: NESTED.cwd, submodule: NESTED });
  });

  it("falls back to the root while the selection is not listed", () => {
    expect(
      resolveGitRepoTarget({ rootCwd: ROOT, submodules: undefined, selectedPath: LIB.path }),
    ).toEqual({ cwd: ROOT, submodule: null });
    expect(
      resolveGitRepoTarget({ rootCwd: ROOT, submodules: [NESTED], selectedPath: LIB.path }),
    ).toEqual({ cwd: ROOT, submodule: null });
  });
});

describe("shouldResetGitRepoSelection", () => {
  it("keeps a selection the loaded root status still lists", () => {
    expect(
      shouldResetGitRepoSelection({
        selectedPath: LIB.path,
        rootStatusLoaded: true,
        submodules: [LIB],
      }),
    ).toBe(false);
  });

  it("keeps the selection while the root status is loading", () => {
    expect(
      shouldResetGitRepoSelection({
        selectedPath: LIB.path,
        rootStatusLoaded: false,
        submodules: undefined,
      }),
    ).toBe(false);
  });

  it("resets once the loaded root status drops the submodule", () => {
    expect(
      shouldResetGitRepoSelection({
        selectedPath: LIB.path,
        rootStatusLoaded: true,
        submodules: [NESTED],
      }),
    ).toBe(true);
    // Older servers omit the list entirely.
    expect(
      shouldResetGitRepoSelection({
        selectedPath: LIB.path,
        rootStatusLoaded: true,
        submodules: undefined,
      }),
    ).toBe(true);
  });
});

describe("toRootRepoPath", () => {
  it("prefixes submodule-relative paths and leaves root paths alone", () => {
    expect(toRootRepoPath(LIB, "src/index.ts")).toBe("vendor/lib/src/index.ts");
    expect(toRootRepoPath(null, "src/index.ts")).toBe("src/index.ts");
  });
});
