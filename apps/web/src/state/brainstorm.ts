import { useAtomValue } from "@effect/atom-react";
import { createBrainstormEnvironmentAtoms } from "@t3tools/client-runtime/state/brainstorm";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { resolveManagerEnvironmentId } from "../components/brainstorm/brainstorm.logic";
import { connectionAtomRuntime } from "../connection/runtime";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { environmentServerConfigsAtom } from "./server";

export const brainstormEnvironment = createBrainstormEnvironmentAtoms(connectionAtomRuntime);

/** The environment that runs the manager; see `resolveManagerEnvironmentId`. */
export const managerEnvironmentIdAtom = Atom.make((get) =>
  resolveManagerEnvironmentId(get(primaryEnvironmentIdAtom), get(environmentServerConfigsAtom)),
).pipe(Atom.withLabel("web-manager-environment-id"));

export function useManagerEnvironmentId(): EnvironmentId | null {
  return useAtomValue(managerEnvironmentIdAtom);
}
