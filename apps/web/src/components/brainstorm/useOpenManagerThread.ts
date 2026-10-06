import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { ALL_SPACE_ID } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Opens the manager thread with its composer focused. The server creates the
 * manager the first time (in the default profile's brain project, else the
 * project used most recently) and returns the same thread after that.
 */
export function useOpenManagerThread(): () => Promise<void> {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const openManager = useAtomCommand(brainstormEnvironment.open, "Open manager");
  return useCallback(async () => {
    if (environmentId === null) return;
    const result = await openManager({ environmentId, input: { spaceId: ALL_SPACE_ID } });
    if (result._tag === "Failure") return;
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: result.value.threadId },
    });
    // A thread that was already open keeps its composer; ask it for focus.
    window.requestAnimationFrame(dispatchSnapShotComposerFocus);
  }, [environmentId, navigate, openManager]);
}
