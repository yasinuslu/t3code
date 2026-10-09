/**
 * Keeps the server's view of spaces current for the managers and their tools,
 * tells the lists which threads are managers, hides the other brainstorm chats
 * from them, and remembers the last profile space as the manager to show.
 * Works on every environment that hosts a manager. Mounted once in the app
 * shell.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useActiveSpaceProfile, useBrainstormStore } from "../../brainstormStore";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentIds } from "../../state/brainstorm";
import { useEnvironment } from "../../state/environments";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  SINGLE_MANAGER_KEY,
  brainstormSpacesInput,
  membershipChangesToAdopt,
  resolveManagerEnvironmentId,
} from "./brainstorm.logic";

const SYNC_DELAY_MS = 300;

export function BrainstormHost() {
  const environmentIds = useManagerEnvironmentIds();

  // Switching to a profile space anywhere picks that profile's manager for later.
  const activeSpaceProfile = useActiveSpaceProfile();
  const setLastManagerProfile = useBrainstormStore((store) => store.setLastManagerProfile);
  const profiles = useBrainstormStore((store) => store.profiles);
  useEffect(() => {
    if (activeSpaceProfile !== null && profiles?.includes(activeSpaceProfile)) {
      setLastManagerProfile(activeSpaceProfile);
    }
  }, [activeSpaceProfile, profiles, setLastManagerProfile]);

  return environmentIds.map((environmentId) => (
    <ManagerEnvironmentSync key={environmentId} environmentId={environmentId} />
  ));
}

/** Mirrors spaces to one manager-hosting environment and reports the managers it runs. */
function ManagerEnvironmentSync({ environmentId }: { readonly environmentId: EnvironmentId }) {
  // Mirror again on (re)connect: the manager's machine may connect after this mounts.
  const connected = useEnvironment(environmentId)?.connection.phase === "connected";

  const spaces = useSpaceStore((store) => store.spaces);
  const memberships = useSpaceStore((store) => store.customSpaceIdsByProjectKey);
  const defaultProfile = useBrainstormStore((store) => store.defaultProfile);
  const syncSpaces = useAtomCommand(brainstormEnvironment.syncSpaces, { reportFailure: false });
  useEffect(() => {
    if (!connected) return;
    const timer = window.setTimeout(() => {
      void syncSpaces({
        environmentId,
        input: brainstormSpacesInput(
          { spaces, customSpaceIdsByProjectKey: memberships },
          environmentId,
          defaultProfile,
        ),
      });
    }, SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [connected, defaultProfile, environmentId, memberships, spaces, syncSpaces]);

  const state = useEnvironmentQuery(brainstormEnvironment.state({ environmentId, input: {} })).data;

  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const setEnvironmentManagers = useBrainstormStore((store) => store.setEnvironmentManagers);
  useEffect(() => {
    if (state === null) return;
    // Only the managers this environment runs: another machine may run a profile's now.
    const hosts = (profile: string | null) =>
      resolveManagerEnvironmentId(primaryEnvironmentId, serverConfigs, profile) === environmentId;
    const managerThreadKeyByProfile: Record<string, string> = {};
    const singleId = state.threadIdsBySpaceId[ALL_SPACE_ID];
    if (singleId && hosts(null)) {
      managerThreadKeyByProfile[SINGLE_MANAGER_KEY] = `${environmentId}:${singleId}`;
    }
    for (const [profile, threadId] of Object.entries(state.managerThreadIdsByProfile ?? {})) {
      if (hosts(profile)) managerThreadKeyByProfile[profile] = `${environmentId}:${threadId}`;
    }
    setEnvironmentManagers(environmentId, {
      managerThreadKeyByProfile,
      profiles: state.profiles,
      serverDefaultProfile: state.defaultProfile,
      hiddenThreadKeys: new Set(
        state.hiddenThreadIds.map((threadId) => `${environmentId}:${threadId}`),
      ),
    });
  }, [environmentId, primaryEnvironmentId, serverConfigs, setEnvironmentManagers, state]);
  useEffect(
    () => () => setEnvironmentManagers(environmentId, null),
    [environmentId, setEnvironmentManagers],
  );

  // The agent changed a custom space's projects: adopt the server's view.
  const adoptedRevision = useRef(0);
  useEffect(() => {
    if (state === null) return;
    if (state.membershipRevision <= adoptedRevision.current) return;
    adoptedRevision.current = state.membershipRevision;
    const store = useSpaceStore.getState();
    for (const [projectKey, spaceId, member] of membershipChangesToAdopt(
      store.customSpaceIdsByProjectKey,
      state.customSpaceIdsByProjectId,
      environmentId,
    )) {
      store.setProjectsInSpace([projectKey], spaceId, member);
    }
  }, [environmentId, state]);

  return null;
}
