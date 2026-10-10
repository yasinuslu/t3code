import { useAtomValue } from "@effect/atom-react";
import { createPreviewLinkStates } from "@t3tools/client-runtime/state/preview-links";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

const previewLinkStates = createPreviewLinkStates(connectionAtomRuntime);

/** Keeps `urls` polled while mounted; a URL with no entry is `unknown`. */
export const usePreviewLinkStates = (environmentId: EnvironmentId, urls: ReadonlyArray<string>) =>
  useAtomValue(previewLinkStates.statesAtom({ environmentId, urls }));

/** Re-reads previews after opening one, which wakes it. Without `urls`, every mounted preview. */
export const refreshPreviewLinkStates = previewLinkStates.refresh;
