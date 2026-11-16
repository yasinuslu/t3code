import { createContextBreakdownEnvironmentAtoms } from "@t3tools/client-runtime/state/context-breakdown";

import { connectionAtomRuntime } from "../connection/runtime";

export const contextBreakdownEnvironment =
  createContextBreakdownEnvironmentAtoms(connectionAtomRuntime);
