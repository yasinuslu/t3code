/**
 * A repository a thread's git actions and review diffs can target: the
 * thread's own worktree (`path: null`), or one of its initialized
 * submodules. All git RPCs already resolve their repo from `cwd`, so
 * targeting a submodule is just passing its absolute worktree path.
 */
export interface GitTargetRepositoryOption {
  /** Relative to the root worktree, `/`-separated. `null` selects the root. */
  readonly path: string | null;
  readonly cwd: string;
  readonly hasChanges: boolean;
}

export interface GitTargetRepositorySubmodule {
  readonly path: string;
  readonly cwd: string;
  readonly hasChanges: boolean;
}

export interface GitTargetRepositoryResolution {
  readonly hasSubmodules: boolean;
  readonly options: ReadonlyArray<GitTargetRepositoryOption>;
  /** `selectedPath` echoed back only once confirmed to still be a live submodule. */
  readonly selectedPath: string | null;
  readonly targetCwd: string | null;
  /**
   * True once the root status has loaded and the previously selected
   * submodule path is no longer among its submodules — the caller should
   * persist a reset to root (`path: null`) for this thread.
   */
  readonly shouldResetSelection: boolean;
}

/**
 * Pure resolution of the effective git target repository from the thread's
 * root worktree, its currently known submodules (`null` while the root
 * status hasn't loaded yet), and the previously selected submodule path (if
 * any). Kept side-effect free so the reset-on-disappearance rule and the
 * picker's option list can be unit tested without mounting the owning hook.
 */
export function resolveGitTargetRepositorySelection(input: {
  readonly rootCwd: string | null;
  readonly rootHasWorkingTreeChanges: boolean;
  readonly submodules: ReadonlyArray<GitTargetRepositorySubmodule> | null;
  readonly selectedPath: string | null;
}): GitTargetRepositoryResolution {
  const { rootCwd, rootHasWorkingTreeChanges, submodules, selectedPath } = input;

  const selectedSubmodule = selectedPath
    ? ((submodules ?? []).find((submodule) => submodule.path === selectedPath) ?? null)
    : null;

  const options: ReadonlyArray<GitTargetRepositoryOption> = rootCwd
    ? [
        { path: null, cwd: rootCwd, hasChanges: rootHasWorkingTreeChanges },
        ...(submodules ?? []).map((submodule) => ({
          path: submodule.path,
          cwd: submodule.cwd,
          hasChanges: submodule.hasChanges,
        })),
      ]
    : [];

  return {
    hasSubmodules: (submodules?.length ?? 0) > 0,
    options,
    selectedPath: selectedSubmodule ? selectedPath : null,
    targetCwd: selectedSubmodule ? selectedSubmodule.cwd : rootCwd,
    // Only resettable once the root status has actually loaded (submodules
    // !== null) — otherwise a not-yet-loaded list would look identical to a
    // genuinely empty one and would spuriously reset a valid selection.
    shouldResetSelection:
      selectedPath !== null && submodules !== null && selectedSubmodule === null,
  };
}
