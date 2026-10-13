import { useAtomValue } from "@effect/atom-react";
import { createGrowEnvironmentAtoms } from "@t3tools/client-runtime/state/grow";
import type { GrowCard } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSummaries } from "./presentation";

export const growEnvironment = createGrowEnvironmentAtoms(connectionAtomRuntime);

/** Every connected environment's cards, keyed `${environmentId}:${threadId}`. */
const growCardsAtom = Atom.make((get) => {
  const cards = new Map<string, GrowCard>();
  for (const environmentId of get(environmentSummaries.connectedEnvironmentIdsAtom)) {
    const state = Option.getOrNull(
      AsyncResult.value(get(growEnvironment.state({ environmentId, input: {} }))),
    );
    for (const card of state?.cards ?? []) cards.set(`${environmentId}:${card.threadId}`, card);
  }
  return cards as ReadonlyMap<string, GrowCard>;
}).pipe(Atom.withLabel("web-grow-cards"));

export function useGrowCards(): ReadonlyMap<string, GrowCard> {
  return useAtomValue(growCardsAtom);
}
