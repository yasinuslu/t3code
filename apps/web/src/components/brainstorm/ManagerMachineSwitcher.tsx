/**
 * Switches between the machines that each run their own manager for the
 * profile in view (every machine that lists it in Managers hosted here). Each
 * machine's manager is a separate chat; switching moves nothing between them.
 * Shown next to the profile switcher; renders nothing with fewer than two.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useBrainstormStore, useManagerProfile } from "../../brainstormStore";
import { useManagerEnvironmentId, useManagerHostIds } from "../../state/brainstorm";
import { useThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SINGLE_MANAGER_KEY, managerSlot } from "./brainstorm.logic";

export function ManagerMachineSwitcher(props: {
  /** Runs after the pick is stored, e.g. to open that machine's manager page. */
  readonly onSelect?: (profile: string | null) => void;
  readonly className?: string;
}) {
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
        props.onSelect?.(profile);
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
  const phase = environment?.connection.phase;
  const offline = phase === "offline" || phase === "error";
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
