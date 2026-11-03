import { useAtomValue } from "@effect/atom-react";
import { type ForkFeature, isForkFeatureOn } from "@t3tools/contracts";

import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryServerSettingsAtom } from "./state/server";

/** Whether a fork feature is on, as the primary environment's settings say. */
export function useForkFeature(feature: ForkFeature): boolean {
  return useAtomValue(primaryServerSettingsAtom, (settings) => isForkFeatureOn(settings, feature));
}

/** `useForkFeature` read once, for handlers and stores outside React. */
export function forkFeatureNow(feature: ForkFeature): boolean {
  return isForkFeatureOn(appAtomRegistry.get(primaryServerSettingsAtom), feature);
}
