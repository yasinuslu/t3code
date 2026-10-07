/**
 * Keeps the server's view of spaces current for the manager and its tools,
 * tells the lists which thread is the manager, and hides the other brainstorm
 * chats from them. Works on the environment that hosts the manager. Mounted
 * once in the app shell.
 */
import { useEffect, useRef } from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentId } from "../../state/brainstorm";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { brainstormSpacesInput, membershipChangesToAdopt } from "./brainstorm.logic";

const SYNC_DELAY_MS = 300;

export function BrainstormHost() {
  const environmentId = useManagerEnvironmentId();

  const spaces = useSpaceStore((store) => store.spaces);
  const memberships = useSpaceStore((store) => store.customSpaceIdsByProjectKey);
  const defaultProfile = useBrainstormStore((store) => store.defaultProfile);
  const syncSpaces = useAtomCommand(brainstormEnvironment.syncSpaces, { reportFailure: false });
  useEffect(() => {
    if (environmentId === null) return;
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
  }, [defaultProfile, environmentId, memberships, spaces, syncSpaces]);

  const state = useEnvironmentQuery(
    environmentId === null ? null : brainstormEnvironment.state({ environmentId, input: {} }),
  ).data;

  const setHiddenThreadKeys = useBrainstormStore((store) => store.setHiddenThreadKeys);
  const setManagerThreadKey = useBrainstormStore((store) => store.setManagerThreadKey);
  useEffect(() => {
    if (environmentId === null || state === null) return;
    const managerId = state.threadIdsBySpaceId[ALL_SPACE_ID];
    setManagerThreadKey(managerId ? `${environmentId}:${managerId}` : null);
    setHiddenThreadKeys(
      new Set(
        state.hiddenThreadIds
          .filter((threadId) => threadId !== managerId)
          .map((threadId) => `${environmentId}:${threadId}`),
      ),
    );
  }, [environmentId, setHiddenThreadKeys, setManagerThreadKey, state]);

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
