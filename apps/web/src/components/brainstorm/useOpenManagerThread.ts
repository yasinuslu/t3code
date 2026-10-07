import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { openHomeOverlay, useHomeOverlayStore } from "../../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { ALL_SPACE_ID } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentId } from "../../state/brainstorm";
import { useThreadShell } from "../../state/entities";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

function parseThreadKey(key: string) {
  const separator = key.indexOf(":");
  return {
    environmentId: key.slice(0, separator) as EnvironmentId,
    threadId: key.slice(separator + 1) as ThreadId,
  };
}

export type ManagerThreadState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Ready"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/**
 * The manager thread, created on first use on the environment that hosts
 * the manager (see `managerEnvironmentIdAtom`). The server makes it in the
 * default profile's brain project (else the project used most recently) and
 * returns the same thread after that, so this only asks when the client does
 * not know it yet.
 */
export function useEnsureManagerThread(): ManagerThreadState {
  const environmentId = useManagerEnvironmentId();
  const storedKey = useBrainstormStore((state) => state.managerThreadKey);
  // A key from before the manager moved to another environment is not this one.
  const knownKey =
    environmentId !== null && storedKey?.startsWith(`${environmentId}:`) ? storedKey : null;
  const knownShell = useThreadShell(knownKey === null ? null : parseThreadKey(knownKey));
  // An archived manager is replaced: the server starts a new one on open.
  const managerThreadKey = knownShell?.archivedAt != null ? null : knownKey;
  const openManager = useAtomCommand(brainstormEnvironment.open, { reportFailure: false });
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (environmentId === null || managerThreadKey !== null) return;
    let cancelled = false;
    void openManager({ environmentId, input: { spaceId: ALL_SPACE_ID } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Failure") setFailure(formatEnvironmentQueryError(result.cause));
      else
        useBrainstormStore
          .getState()
          .setManagerThreadKey(`${environmentId}:${result.value.threadId}`);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, managerThreadKey, openManager]);
  if (managerThreadKey !== null) return { _tag: "Ready", ...parseThreadKey(managerThreadKey) };
  return failure === null ? { _tag: "Loading" } : { _tag: "Failed", message: failure };
}

/** Opens Home, where the manager is docked, with the manager's composer focused. */
export function openManagerHome(): void {
  if (useHomeOverlayStore.getState().open) dispatchSnapShotComposerFocus();
  else openHomeOverlay();
}
