/**
 * Keeps the server's view of spaces current for the manager and its tools,
 * and hides brainstorm and manager chats from the thread lists. Mounted once in
 * the app shell, so it works whether or not the manager screen is open.
 */
import { useEffect, useRef } from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { brainstormSpacesInput, membershipChangesToAdopt } from "./brainstorm.logic";

const SYNC_DELAY_MS = 300;

export function BrainstormHost() {
  const environmentId = usePrimaryEnvironmentId();

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
  useEffect(() => {
    if (environmentId === null || state === null) return;
    setHiddenThreadKeys(
      new Set(
        [...Object.values(state.threadIdsBySpaceId), ...state.hiddenThreadIds].map(
          (threadId) => `${environmentId}:${threadId}`,
        ),
      ),
    );
  }, [environmentId, setHiddenThreadKeys, state]);

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
