import { useAtomValue } from "@effect/atom-react";
import { createBrainstormEnvironmentAtoms } from "@t3tools/client-runtime/state/brainstorm";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useBrainstormStore } from "../brainstormStore";
import {
  SINGLE_MANAGER_KEY,
  resolveManagerEnvironmentIds,
  resolveManagerHostIds,
} from "../components/brainstorm/brainstorm.logic";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { environmentServerConfigsAtom } from "./server";

export const brainstormEnvironment = createBrainstormEnvironmentAtoms(connectionAtomRuntime);

let previousManagerEnvironmentIds: ReadonlyArray<EnvironmentId> = [];
/** Every environment that runs a manager; see `resolveManagerEnvironmentIds`. */
const managerEnvironmentIdsAtom = Atom.make((get) => {
  const next = resolveManagerEnvironmentIds(
    get(primaryEnvironmentIdAtom),
    get(environmentServerConfigsAtom),
  );
  if (next.join("\n") === previousManagerEnvironmentIds.join("\n")) {
    return previousManagerEnvironmentIds;
  }
  previousManagerEnvironmentIds = next;
  return next;
}).pipe(Atom.withLabel("web-manager-environment-ids"));

/** Every machine that runs `profile`'s manager; see `resolveManagerHostIds`. */
export function useManagerHostIds(profile: string | null): ReadonlyArray<EnvironmentId> {
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  return useMemo(
    () => resolveManagerHostIds(primaryEnvironmentId, serverConfigs, profile),
    [primaryEnvironmentId, profile, serverConfigs],
  );
}

/** The machine whose manager Home shows; see `resolveManagerEnvironmentId`. */
export function useManagerEnvironmentId(profile: string | null): EnvironmentId | null {
  const hosts = useManagerHostIds(profile);
  const picked = useBrainstormStore(
    (state) => state.lastManagerEnvironmentByProfile[profile ?? SINGLE_MANAGER_KEY] ?? null,
  );
  return hosts.find((environmentId) => environmentId === picked) ?? hosts[0] ?? null;
}

export function useManagerEnvironmentIds(): ReadonlyArray<EnvironmentId> {
  return useAtomValue(managerEnvironmentIdsAtom);
}
