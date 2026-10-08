/**
 * Keeps the server's view of spaces current for the managers and their tools,
 * tells the lists which threads are managers, hides the other brainstorm chats
 * from them, and remembers the last profile space as the manager to show.
 * Works on the environment that hosts the managers. Mounted once in the app
 * shell.
 */
import { useEffect, useRef } from "react";

import { useActiveSpaceProfile, useBrainstormStore } from "../../brainstormStore";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentId } from "../../state/brainstorm";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  SINGLE_MANAGER_KEY,
  brainstormSpacesInput,
  membershipChangesToAdopt,
} from "./brainstorm.logic";

const SYNC_DELAY_MS = 300;

export function BrainstormHost() {
  const environmentId = useManagerEnvironmentId();
  // Mirror again on (re)connect: the manager's machine may connect after this mounts.
  const connected = useEnvironment(environmentId)?.connection.phase === "connected";

  const spaces = useSpaceStore((store) => store.spaces);
  const memberships = useSpaceStore((store) => store.customSpaceIdsByProjectKey);
  const defaultProfile = useBrainstormStore((store) => store.defaultProfile);
  const syncSpaces = useAtomCommand(brainstormEnvironment.syncSpaces, { reportFailure: false });
  useEffect(() => {
    if (environmentId === null || !connected) return;
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

  const state = useEnvironmentQuery(
    environmentId === null ? null : brainstormEnvironment.state({ environmentId, input: {} }),
  ).data;

  const setHiddenThreadKeys = useBrainstormStore((store) => store.setHiddenThreadKeys);
  const setManagers = useBrainstormStore((store) => store.setManagers);
  useEffect(() => {
    if (environmentId === null || state === null) return;
    const managerThreadKeyByProfile: Record<string, string> = {};
    const singleId = state.threadIdsBySpaceId[ALL_SPACE_ID];
    if (singleId) managerThreadKeyByProfile[SINGLE_MANAGER_KEY] = `${environmentId}:${singleId}`;
    for (const [profile, threadId] of Object.entries(state.managerThreadIdsByProfile ?? {})) {
      managerThreadKeyByProfile[profile] = `${environmentId}:${threadId}`;
    }
    setManagers({
      managerThreadKeyByProfile,
      profiles: state.profiles,
      serverDefaultProfile: state.defaultProfile,
    });
    setHiddenThreadKeys(
      new Set(state.hiddenThreadIds.map((threadId) => `${environmentId}:${threadId}`)),
    );
  }, [environmentId, setHiddenThreadKeys, setManagers, state]);

  // Switching to a profile space anywhere picks that profile's manager for later.
  const activeSpaceProfile = useActiveSpaceProfile();
  const setLastManagerProfile = useBrainstormStore((store) => store.setLastManagerProfile);
  const profiles = useBrainstormStore((store) => store.profiles);
  useEffect(() => {
    if (activeSpaceProfile !== null && profiles?.includes(activeSpaceProfile)) {
      setLastManagerProfile(activeSpaceProfile);
    }
  }, [activeSpaceProfile, profiles, setLastManagerProfile]);

  // The agent changed a custom space's projects: adopt the server's view.
  const adoptedRevision = useRef(0);
  useEffect(() => {
    if (environmentId === null || state === null) return;
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
