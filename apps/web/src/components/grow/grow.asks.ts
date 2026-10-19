/**
 * What the user sent a thread from Grow (a What if, a reply, Ship), kept on
 * this device so the item can say what it is working on, and what an answer
 * answers. Threads do not carry their messages' text in the shell.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

export interface GrowAsk {
  readonly text: string;
  readonly kind: "whatIf" | "reply" | "ship" | "proof";
  /** Epoch ms when it was sent. */
  readonly at: number;
}

const MAX_ASKS_PER_THREAD = 5;

export const useGrowAsks = create<{
  readonly asks: Readonly<Record<string, readonly GrowAsk[]>>;
}>()(
  persist(() => ({ asks: {} }), {
    name: "t3code:grow-asks:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
  }),
);

export function recordGrowAsk(key: string, ask: GrowAsk) {
  useGrowAsks.setState(({ asks }) => ({
    asks: { ...asks, [key]: [...(asks[key] ?? []), ask].slice(-MAX_ASKS_PER_THREAD) },
  }));
}
