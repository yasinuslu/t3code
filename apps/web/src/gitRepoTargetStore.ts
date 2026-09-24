import type { VcsStatusSubmodule } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Which repository a thread's git actions and working-tree/branch diffs target: the root repo
 * (no entry) or one of its submodules, keyed by the submodule `path` from the root status.
 * Keyed by `scopedThreadKey`. Session-only: a reload lands back on the root repo.
 */
interface GitRepoTargetStoreState {
  submodulePathByThreadKey: Record<string, string>;
  selectSubmodule: (threadKey: string, path: string | null) => void;
}

export const useGitRepoTargetStore = create<GitRepoTargetStoreState>()((set) => ({
  submodulePathByThreadKey: {},
  selectSubmodule: (threadKey, path) =>
    set((state) => {
      if ((state.submodulePathByThreadKey[threadKey] ?? null) === path) return state;
      const { [threadKey]: _previous, ...rest } = state.submodulePathByThreadKey;
      return { submodulePathByThreadKey: path === null ? rest : { ...rest, [threadKey]: path } };
    }),
}));

export interface GitRepoTarget {
  /** The cwd git RPCs should use. */
  readonly cwd: string;
  /** The selected submodule, or null for the root repo. */
  readonly submodule: VcsStatusSubmodule | null;
}

/**
 * Resolves the selected submodule against the root status. A selection that is not in the list
 * (removed, deinitialized, or status still loading) targets the root repo.
 */
export function resolveGitRepoTarget(input: {
  readonly rootCwd: string;
  readonly submodules: ReadonlyArray<VcsStatusSubmodule> | undefined;
  readonly selectedPath: string | null;
}): GitRepoTarget {
  const submodule =
    input.selectedPath === null
      ? undefined
      : input.submodules?.find((candidate) => candidate.path === input.selectedPath);
  return submodule ? { cwd: submodule.cwd, submodule } : { cwd: input.rootCwd, submodule: null };
}

/**
 * A stored selection is dropped once a loaded root status no longer lists it. While the root
 * status is loading (`submodules` unknown) the selection is kept.
 */
export function shouldResetGitRepoSelection(input: {
  readonly selectedPath: string | null;
  readonly rootStatusLoaded: boolean;
  readonly submodules: ReadonlyArray<VcsStatusSubmodule> | undefined;
}): boolean {
  if (input.selectedPath === null || !input.rootStatusLoaded) return false;
  return !(input.submodules ?? []).some((candidate) => candidate.path === input.selectedPath);
}

/** Maps a path relative to the selected repo onto the root repo, for file openers. */
export function toRootRepoPath(submodule: VcsStatusSubmodule | null, filePath: string): string {
  return submodule ? `${submodule.path}/${filePath}` : filePath;
}
