import { useCallback, useEffect } from "react";

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { scopedThreadKey } from "../lib/scopedEntities";
import { resolveGitTargetRepositorySelection } from "./gitTargetRepositorySelection";
import { useEnvironmentQuery } from "./query";
import { useThreadSelection } from "./use-thread-selection";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";
import { vcsEnvironment } from "./vcs";

export type { GitTargetRepositoryOption } from "./gitTargetRepositorySelection";

const EMPTY_TARGET_PATH_ATOM = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:git-target-repository:path:null"),
);

const selectedGitTargetPathByThreadKeyAtom = Atom.family((threadKey: string) =>
  Atom.make<string | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mobile:git-target-repository:path:${threadKey}`),
  ),
);

export function setSelectedThreadGitTargetPath(threadKey: string, path: string | null): void {
  appAtomRegistry.set(selectedGitTargetPathByThreadKeyAtom(threadKey), path);
}

/**
 * Resolves the thread's currently selected git target repository (root or a
 * submodule) and exposes the picker options. The selection is per-thread and
 * resets to root whenever the selected submodule is no longer present in the
 * root status's `submodules` list (branch switch, deinit, etc.) — see
 * `resolveGitTargetRepositorySelection` for the reset rule itself.
 */
export function useSelectedThreadGitTargetRepository() {
  const { selectedThread } = useThreadSelection();
  const { selectedThreadCwd: rootCwd } = useSelectedThreadWorktree();
  const threadKey = selectedThread
    ? scopedThreadKey(selectedThread.environmentId, selectedThread.id)
    : null;
  const selectedPath = useAtomValue(
    threadKey ? selectedGitTargetPathByThreadKeyAtom(threadKey) : EMPTY_TARGET_PATH_ATOM,
  );

  const rootStatus = useEnvironmentQuery(
    selectedThread !== null && rootCwd !== null
      ? vcsEnvironment.status({
          environmentId: selectedThread.environmentId,
          input: { cwd: rootCwd },
        })
      : null,
  );

  const resolution = resolveGitTargetRepositorySelection({
    rootCwd,
    rootHasWorkingTreeChanges: rootStatus.data?.hasWorkingTreeChanges ?? false,
    submodules: rootStatus.data?.submodules ?? null,
    selectedPath,
  });

  useEffect(() => {
    if (threadKey && resolution.shouldResetSelection) {
      setSelectedThreadGitTargetPath(threadKey, null);
    }
  }, [threadKey, resolution.shouldResetSelection]);

  const selectTarget = useCallback(
    (path: string | null) => {
      if (threadKey) {
        setSelectedThreadGitTargetPath(threadKey, path);
      }
    },
    [threadKey],
  );

  return {
    hasSubmodules: resolution.hasSubmodules,
    options: resolution.options,
    selectedPath: resolution.selectedPath,
    targetCwd: resolution.targetCwd,
    selectTarget,
  };
}
