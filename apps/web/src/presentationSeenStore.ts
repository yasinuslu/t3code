/**
 * Which version of each thread's presentation the user last looked at, so the panel's button can
 * say it changed since. Keyed by thread; the value is the presentation's own `updatedAt`.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Threads remembered; the oldest looks fall off first so the record stays small. */
const MAX_THREADS = 500;

interface PresentationSeenState {
  readonly seenByThreadKey: Readonly<Record<string, string>>;
  readonly markSeen: (ref: ScopedThreadRef, updatedAt: string) => void;
}

export const usePresentationSeenStore = create<PresentationSeenState>()(
  persist(
    (set) => ({
      seenByThreadKey: {},
      markSeen: (ref, updatedAt) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          const current = state.seenByThreadKey[key];
          if (current !== undefined && current >= updatedAt) return state;
          const { [key]: _replaced, ...rest } = state.seenByThreadKey;
          const entries = Object.entries(rest).slice(-(MAX_THREADS - 1));
          return { seenByThreadKey: { ...Object.fromEntries(entries), [key]: updatedAt } };
        }),
    }),
    {
      name: "t3code:presentation-seen:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);

/** Whether the presentation changed since the user last looked at it (a never-seen one counts). */
export function isPresentationUnseen(seen: string | undefined, updatedAt: string | undefined) {
  return updatedAt !== undefined && (seen === undefined || seen < updatedAt);
}

export function usePresentationUnseen(
  ref: ScopedThreadRef | null,
  updatedAt: string | undefined,
): boolean {
  const seen = usePresentationSeenStore((state) =>
    ref === null ? undefined : state.seenByThreadKey[scopedThreadKey(ref)],
  );
  return isPresentationUnseen(seen, updatedAt);
}
