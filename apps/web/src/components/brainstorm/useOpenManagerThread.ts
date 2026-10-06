import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { ALL_SPACE_ID } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { useThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
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
 * The manager thread, created on first use. The server makes it in the
 * default profile's brain project (else the project used most recently) and
 * returns the same thread after that, so this only asks when the client does
 * not know it yet.
 */
export function useEnsureManagerThread(): ManagerThreadState {
  const environmentId = usePrimaryEnvironmentId();
  const knownKey = useBrainstormStore((state) => state.managerThreadKey);
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

/** Goes Home, where the manager is docked, with the manager's composer focused. */
export function useOpenManagerThread(): () => Promise<void> {
  const navigate = useNavigate();
  return useCallback(async () => {
    await navigate({ to: "/home" });
    // Home may already be open; ask the docked composer for focus either way.
    window.requestAnimationFrame(dispatchSnapShotComposerFocus);
  }, [navigate]);
}
