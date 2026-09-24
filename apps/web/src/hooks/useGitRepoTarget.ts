import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, VcsStatusSubmodule } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo } from "react";

import {
  resolveGitRepoTarget,
  shouldResetGitRepoSelection,
  useGitRepoTargetStore,
} from "../gitRepoTargetStore";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";

const EMPTY_SUBMODULES: ReadonlyArray<VcsStatusSubmodule> = [];

export interface GitRepoTargetView {
  /** The cwd git RPCs should use: the selected submodule's, else the root's. */
  readonly cwd: string | null;
  /** The selected submodule, or null for the root repo. */
  readonly submodule: VcsStatusSubmodule | null;
  /** Every initialized submodule of the root repo, from the root status. */
  readonly submodules: ReadonlyArray<VcsStatusSubmodule>;
  readonly selectSubmodule: (path: string | null) => void;
}

/**
 * The thread's selected git repository. Keeps the root status subscribed (the submodule list
 * always comes from it) and drops a selection the root no longer lists.
 */
export function useGitRepoTarget(
  threadRef: ScopedThreadRef | null | undefined,
  rootCwd: string | null,
): GitRepoTargetView {
  const environmentId = threadRef?.environmentId ?? null;
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const rootStatus = useEnvironmentQuery(
    environmentId !== null && rootCwd !== null
      ? vcsEnvironment.status({ environmentId, input: { cwd: rootCwd } })
      : null,
  );
  const selectedPath = useGitRepoTargetStore((state) =>
    threadKey === null ? null : (state.submodulePathByThreadKey[threadKey] ?? null),
  );
  const submodules = rootStatus.data?.submodules;
  const rootStatusLoaded = rootStatus.data !== null;

  useEffect(() => {
    if (threadKey === null) return;
    if (shouldResetGitRepoSelection({ selectedPath, rootStatusLoaded, submodules })) {
      useGitRepoTargetStore.getState().selectSubmodule(threadKey, null);
    }
  }, [threadKey, selectedPath, rootStatusLoaded, submodules]);

  const selectSubmodule = useCallback(
    (path: string | null) => {
      if (threadKey !== null) useGitRepoTargetStore.getState().selectSubmodule(threadKey, path);
    },
    [threadKey],
  );

  return useMemo(() => {
    const target =
      rootCwd === null
        ? { cwd: null, submodule: null }
        : resolveGitRepoTarget({ rootCwd, submodules, selectedPath });
    return { ...target, submodules: submodules ?? EMPTY_SUBMODULES, selectSubmodule };
  }, [rootCwd, selectSubmodule, selectedPath, submodules]);
}
