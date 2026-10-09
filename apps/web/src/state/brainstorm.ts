import { useAtomValue } from "@effect/atom-react";
import { createBrainstormEnvironmentAtoms } from "@t3tools/client-runtime/state/brainstorm";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  SINGLE_MANAGER_KEY,
  resolveManagerEnvironmentId,
  resolveManagerEnvironmentIds,
} from "../components/brainstorm/brainstorm.logic";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { environmentServerConfigsAtom } from "./server";

export const brainstormEnvironment = createBrainstormEnvironmentAtoms(connectionAtomRuntime);

/**
 * The environment that runs a profile's manager, keyed by profile
 * (`SINGLE_MANAGER_KEY` for none); see `resolveManagerEnvironmentId`.
 */
const managerEnvironmentIdAtom = Atom.family((profileKey: string) =>
  Atom.make((get) =>
    resolveManagerEnvironmentId(
      get(primaryEnvironmentIdAtom),
      get(environmentServerConfigsAtom),
      profileKey === SINGLE_MANAGER_KEY ? null : profileKey,
    ),
  ).pipe(Atom.withLabel(`web-manager-environment-id:${profileKey}`)),
);

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

export function useManagerEnvironmentId(profile: string | null): EnvironmentId | null {
  return useAtomValue(managerEnvironmentIdAtom(profile ?? SINGLE_MANAGER_KEY));
}

export function useManagerEnvironmentIds(): ReadonlyArray<EnvironmentId> {
  return useAtomValue(managerEnvironmentIdsAtom);
}
