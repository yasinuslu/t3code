import { createBrainstormEnvironmentAtoms } from "@t3tools/client-runtime/state/brainstorm";

import { connectionAtomRuntime } from "../connection/runtime";

export const brainstormEnvironment = createBrainstormEnvironmentAtoms(connectionAtomRuntime);
