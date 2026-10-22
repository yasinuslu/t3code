/**
 * Switches between the machines that each run their own manager for the
 * profile in view (every machine that lists it in Managers hosted here). Each
 * machine's manager is a separate chat; switching moves nothing between them.
 * Shown in a manager's header; renders nothing with fewer than two.
 */
import {
  type EnvironmentId,
  type ThreadId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useBrainstormStore, useManagerProfile } from "../../brainstormStore";
import { useManagerEnvironmentId, useManagerHostIds } from "../../state/brainstorm";
import { useThreadShell } from "../../state/entities";
import { useEnvironment, useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import type { EnvironmentOption } from "../BranchToolbar.logic";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SINGLE_MANAGER_KEY, isEnvironmentUnreachable, managerSlot } from "./brainstorm.logic";

export function ManagerMachineSwitcher(props: { readonly className?: string }) {
  const profile = useManagerProfile();
  const hosts = useManagerHostIds(profile);
  const current = useManagerEnvironmentId(profile);
  const setLastManagerEnvironment = useBrainstormStore((state) => state.setLastManagerEnvironment);
  if (hosts.length < 2) return null;
  return (
    <ToggleGroup
      aria-label="Manager machine"
      data-manager-machine-switcher=""
      className={props.className}
      value={current === null ? [] : [current]}
      onValueChange={(next) => {
        const picked = next[0];
        // Pressing the active segment again keeps it.
        if (picked === undefined) return;
        setLastManagerEnvironment(profile ?? SINGLE_MANAGER_KEY, picked);
      }}
    >
      {hosts.map((environmentId) => (
        <MachineSegment
          key={environmentId}
          environmentId={environmentId}
          profile={profile}
          selected={environmentId === current}
        />
      ))}
    </ToggleGroup>
  );
}

function MachineSegment(props: {
  readonly environmentId: EnvironmentId;
  readonly profile: string | null;
  readonly selected: boolean;
}) {
  const environment = useEnvironment(props.environmentId);
  const offline = isEnvironmentUnreachable(environment?.connection.phase);
  const label = environment?.label ?? props.environmentId;
  const managerKey = useBrainstormStore(
    (state) => state.managerThreadKeyBySlot[managerSlot(props.environmentId, props.profile)],
  );
  const separator = managerKey?.indexOf(":") ?? -1;
  const shell = useThreadShell(
    managerKey === undefined || props.selected
      ? null
      : {
          environmentId: props.environmentId,
          threadId: managerKey.slice(separator + 1) as ThreadId,
        },
  );
  // The other machine's manager is working or has news: worth a look.
  const status = shell === null ? null : resolveSidebarThreadStatus(shell);
  const needsLook =
    shell !== null &&
    (status === "working" ||
      status === "approval" ||
      status === "input" ||
      hasUnseenCompletion(shell));
  return (
    <Toggle
      value={props.environmentId}
      // The selected one stays pressable so Home can say it is offline instead of moving on.
      disabled={offline && !props.selected}
      aria-label={`${label} manager${offline ? " (offline)" : ""}`}
      title={offline ? `${label} is offline` : undefined}
    >
      {label}
      {offline ? <span className="text-muted-foreground">offline</span> : null}
      {needsLook ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-primary"
          data-manager-machine-activity=""
          aria-hidden
        />
      ) : null}
    </Toggle>
  );
}

/**
 * The machines a manager thread can switch between, for the thread details'
 * "Run on" row: a manager does not move, picking a machine shows that
 * machine's own manager. Null for any other thread, or with one host.
 */
export function useManagerMachineChoice(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): {
  readonly options: ReadonlyArray<EnvironmentOption>;
  readonly select: (environmentId: EnvironmentId) => void;
} | null {
  const slot = useBrainstormStore((state) => {
    if (environmentId === null || threadId === null) return null;
    const key = `${environmentId}:${threadId}`;
    return (
      Object.entries(state.managerThreadKeyBySlot).find(([, value]) => value === key)?.[0] ?? null
    );
  });
  // A slot is `${environmentId}:${profile}`; profile names never contain a colon.
  const profileKey = slot === null ? null : slot.slice(slot.lastIndexOf(":") + 1);
  const profile = profileKey === null || profileKey === SINGLE_MANAGER_KEY ? null : profileKey;
  const hosts = useManagerHostIds(profile);
  const { presentationById } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const setLastManagerEnvironment = useBrainstormStore((state) => state.setLastManagerEnvironment);
  return useMemo(() => {
    if (profileKey === null || hosts.length < 2) return null;
    return {
      options: hosts.map((host) => {
        const presentation = presentationById.get(host);
        return {
          environmentId: host,
          projectId: null,
          label: presentation?.entry.target.label ?? host,
          isPrimary: host === primaryEnvironmentId,
          machine: resolveEnvironmentMachineKind(presentation?.serverConfig ?? null),
          offline: isEnvironmentUnreachable(presentation?.connection.phase),
        };
      }),
      select: (picked: EnvironmentId) => setLastManagerEnvironment(profileKey, picked),
    };
  }, [hosts, presentationById, primaryEnvironmentId, profileKey, setLastManagerEnvironment]);
}
