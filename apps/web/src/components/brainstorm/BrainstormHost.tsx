/**
 * Wires the brainstorm popup into the app: its shortcut (in the app, and
 * system-wide in the desktop app), mirroring spaces to the server, the live
 * brainstorm state, and hiding brainstorm chats from the thread lists.
 */
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef } from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { resolveShortcutCommand } from "../../keybindings";
import { isEditableFocused } from "../../lib/editableFocus";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  BRAINSTORM_TOGGLE_COMMAND,
  brainstormAccelerator,
  brainstormSpacesInput,
  membershipChangesToAdopt,
} from "./brainstorm.logic";
import { BrainstormPopup } from "./BrainstormPopup";

const toggleForActiveSpace = () => {
  useBrainstormStore.getState().toggle(useSpaceStore.getState().activeSpaceId);
};

const SYNC_DELAY_MS = 300;

export function BrainstormHost() {
  const environmentId = usePrimaryEnvironmentId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  useEffect(() => {
    // Capture phase, so a focused composer or terminal cannot swallow it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          editableFocus: isEditableFocused(event.target),
        },
      });
      if (command !== BRAINSTORM_TOGGLE_COMMAND) return;
      event.preventDefault();
      event.stopPropagation();
      toggleForActiveSpace();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action !== BRAINSTORM_TOGGLE_COMMAND) return;
        // The system-wide shortcut brings the window forward; it should open, not close.
        const store = useBrainstormStore.getState();
        if (store.open && document.hasFocus()) store.close();
        else if (!store.open) toggleForActiveSpace();
      }),
    [],
  );

  const accelerator = useMemo(() => brainstormAccelerator(keybindings), [keybindings]);
  useEffect(() => {
    const register = window.desktopBridge?.setBrainstormShortcut;
    if (!register) return;
    void register(accelerator).catch(() => false);
  }, [accelerator]);

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
        Object.values(state.threadIdsBySpaceId).map((threadId) => `${environmentId}:${threadId}`),
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

  if (environmentId === null) return null;
  return <BrainstormPopup environmentId={environmentId} state={state} />;
}
