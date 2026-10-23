/**
 * The web-component library on the client: fetched over the environment's socket (so remote and
 * tunnel clients get it too), its bundle imported once per version, which defines the elements.
 * A tag the copy here lacks refetches it, so a component an agent just added shows up.
 */
import type { ElementManifest, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { growEnvironment } from "../state/grow";
import { useAtomCommand } from "../state/use-atom-command";

export interface ElementsLibrary {
  readonly hash: string;
  readonly components: ReadonlyMap<string, ElementManifest>;
  readonly error?: string | undefined;
}

const libraries = new Map<string, { readonly at: number; readonly library: ElementsLibrary }>();
const inFlight = new Set<string>();
const loadedBundles = new Set<string>();
const listeners = new Set<() => void>();
const REFETCH_AFTER_MS = 10_000;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function importBundle(hash: string, bundle: string) {
  if (loadedBundles.has(hash)) return;
  loadedBundles.add(hash);
  const url = URL.createObjectURL(new Blob([bundle], { type: "text/javascript" }));
  try {
    // The bundle defines only tags not defined yet, so a newer version adds new components; a
    // changed one needs a reload (custom elements cannot be redefined).
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The environment's library, or null while it loads. `wanted` names a tag the caller needs. */
export function useElementsLibrary(
  environmentId: EnvironmentId | null,
  wanted: string,
): ElementsLibrary | null {
  const fetchLibrary = useAtomCommand(growEnvironment.elementsLibrary, { reportFailure: false });
  const key = environmentId ?? "";
  const library = useSyncExternalStore(subscribe, () => libraries.get(key)?.library ?? null);
  const missing = library !== null && !library.components.has(wanted);
  useEffect(() => {
    if (environmentId === null) return;
    const cached = libraries.get(key);
    if (cached !== undefined && (!missing || Date.now() - cached.at < REFETCH_AFTER_MS)) return;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void fetchLibrary({
      environmentId,
      input: cached === undefined ? {} : { knownHash: cached.library.hash },
    })
      .then(async (result) => {
        if (result._tag !== "Success") return;
        const state = result.value;
        let error = state.error;
        if (state.bundle !== undefined) {
          await importBundle(state.hash, state.bundle).catch((cause: unknown) => {
            error = `The library bundle failed to load: ${cause instanceof Error ? cause.message : cause}`;
          });
        }
        libraries.set(key, {
          at: Date.now(),
          library: {
            hash: state.hash,
            components: new Map(state.components.map((component) => [component.tag, component])),
            error,
          },
        });
        for (const listener of listeners) listener();
      })
      .finally(() => inFlight.delete(key));
  }, [environmentId, fetchLibrary, key, missing]);
  return library;
}
