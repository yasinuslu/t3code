import { createElementsEnvironmentAtoms } from "@t3tools/client-runtime/state/elements";

import { connectionAtomRuntime } from "../connection/runtime";

export const elementsEnvironment = createElementsEnvironmentAtoms(connectionAtomRuntime);
