import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/previewEnvironment";

import { connectionAtomRuntime } from "../connection/runtime";

export const previewEnvironmentCommands = createPreviewEnvironmentAtoms(connectionAtomRuntime);
