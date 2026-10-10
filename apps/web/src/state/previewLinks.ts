import { useAtomValue } from "@effect/atom-react";
import { createPreviewLinkStates } from "@t3tools/client-runtime/state/preview-links";
import type { EnvironmentId, ThreadPreviewLinkState } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

const previewLinkStates = createPreviewLinkStates(connectionAtomRuntime);

/** Known states of `urls`, polled while mounted. A missing URL is `unknown`. */
export const usePreviewLinkStates = (
  environmentId: EnvironmentId,
  urls: ReadonlyArray<string>,
): ReadonlyMap<string, ThreadPreviewLinkState> =>
  useAtomValue(previewLinkStates.statesAtom({ environmentId, urls }));

/** Re-reads previews shortly after opening one, which wakes it. */
export const refreshPreviewLinkStates = previewLinkStates.refresh;
