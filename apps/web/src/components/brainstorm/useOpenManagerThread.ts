import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useBrainstormStore, useManagerProfile } from "../../brainstormStore";
import { openHomeOverlay, useHomeOverlayStore } from "../../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentId } from "../../state/brainstorm";
import { useThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SINGLE_MANAGER_KEY } from "./brainstorm.logic";

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

/** A manager key the client can use: on this environment and not archived. */
function useUsableManagerKey(environmentId: EnvironmentId | null, profile: string | null) {
  const storedKey = useBrainstormStore(
    (state) => state.managerThreadKeyByProfile[profile ?? SINGLE_MANAGER_KEY] ?? null,
  );
  // A key from before the manager moved to another environment is not this one.
  const knownKey =
    environmentId !== null && storedKey?.startsWith(`${environmentId}:`) ? storedKey : null;
  const knownShell = useThreadShell(knownKey === null ? null : parseThreadKey(knownKey));
  // An archived manager is replaced: the server starts a new one on open.
  return knownShell?.archivedAt != null ? null : knownKey;
}

/** Opens (creating on first use) a profile's manager on the manager's environment. */
function useOpenManagerCommand() {
  const openManager = useAtomCommand(brainstormEnvironment.open, { reportFailure: false });
  return useCallback(
    async (environmentId: EnvironmentId, profile: string | null) => {
      const result = await openManager({
        environmentId,
        input: { spaceId: ALL_SPACE_ID, ...(profile === null ? {} : { profile }) },
      });
      if (result._tag === "Failure") return result;
      const key = `${environmentId}:${result.value.threadId}`;
      useBrainstormStore.getState().setManagerThreadKey(profile ?? SINGLE_MANAGER_KEY, key);
      return { _tag: "Success" as const, key };
    },
    [openManager],
  );
}

/**
 * The manager thread Home shows (see `useManagerProfile`), created on first
 * use on the environment that hosts the managers (see
 * `managerEnvironmentIdAtom`). The server makes each profile's manager in
 * that profile's brain project and returns the same thread after that, so
 * this only asks when the client does not know it yet.
 */
export function useEnsureManagerThread(): ManagerThreadState {
  const environmentId = useManagerEnvironmentId();
  const profile = useManagerProfile();
  // Until the server lists its profiles, the manager to open is not known.
  const profilesKnown = useBrainstormStore((state) => state.profiles !== null);
  const managerThreadKey = useUsableManagerKey(environmentId, profile);
  // The manager may run on another machine, which connects after this mounts.
  const environment = useEnvironment(environmentId);
  const phase = environment?.connection.phase;
  const connected = phase === "connected";
  const openManager = useOpenManagerCommand();
  const [failure, setFailure] = useState<{ profile: string | null; message: string } | null>(null);
  useEffect(() => {
    if (environmentId === null || managerThreadKey !== null || !connected || !profilesKnown) {
      return;
    }
    let cancelled = false;
    setFailure(null);
    void openManager(environmentId, profile).then((result) => {
      if (!cancelled && result._tag === "Failure") {
        setFailure({ profile, message: formatEnvironmentQueryError(result.cause) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connected, environmentId, managerThreadKey, openManager, profile, profilesKnown]);
  if (managerThreadKey !== null) return { _tag: "Ready", ...parseThreadKey(managerThreadKey) };
  if (failure !== null && failure.profile === profile) {
    return { _tag: "Failed", message: failure.message };
  }
  if (phase === "offline" || phase === "error")
    return {
      _tag: "Failed",
      message: `${environment?.label ?? "Its machine"} is offline; the manager runs there.`,
    };
  return { _tag: "Loading" };
}

/**
 * Makes `profile` the profile in view: its space becomes the active space
 * and its manager the one Home shows. `null` shows every profile's work
 * (the All space) and keeps the manager.
 */
export function selectManagerProfile(profile: string | null): void {
  const spaces = useSpaceStore.getState();
  if (profile === null) {
    spaces.setActiveSpace(ALL_SPACE_ID);
    return;
  }
  useBrainstormStore.getState().setLastManagerProfile(profile);
  // The sidebar seeds profile spaces; a phone that has not shown it yet seeds this one here.
  spaces.recordCodeProfiles([profile], {});
  const space = useSpaceStore.getState().spaces.find((candidate) => candidate.profile === profile);
  if (space) spaces.setActiveSpace(space.id);
}

/**
 * Opens a profile's manager as a thread page, for windows too narrow for
 * Home's docked manager. Creates the manager first when it is new.
 */
export function useOpenManagerThreadPage() {
  const environmentId = useManagerEnvironmentId();
  const openManager = useOpenManagerCommand();
  const navigate = useNavigate();
  return useCallback(
    async (profile: string | null) => {
      // Before the server lists its profiles, which manager is meant is not known yet.
      if (environmentId === null || useBrainstormStore.getState().profiles === null) {
        return openManagerHome();
      }
      const stored =
        useBrainstormStore.getState().managerThreadKeyByProfile[profile ?? SINGLE_MANAGER_KEY];
      const key = stored?.startsWith(`${environmentId}:`)
        ? stored
        : await openManager(environmentId, profile).then((result) =>
            result._tag === "Success" ? result.key : null,
          );
      if (key === null) return openManagerHome();
      await navigate({ to: "/$environmentId/$threadId", params: parseThreadKey(key) });
    },
    [environmentId, navigate, openManager],
  );
}

/** Opens Home, where the manager is docked, with the manager's composer focused. */
export function openManagerHome(): void {
  if (useHomeOverlayStore.getState().open) dispatchSnapShotComposerFocus();
  else openHomeOverlay();
}
