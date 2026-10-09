// @effect-diagnostics globalTimers:off - One shared poll loop per environment, driven by mounted atoms outside an Effect runtime.
import {
  WS_METHODS,
  type EnvironmentId,
  type PreviewLinkStatusResult,
  type ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { AsyncResult, Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export { previewLinkLabel } from "@t3tools/shared/threadPreviewLinks";

const POLL_INTERVAL_MS = 30_000;
/**
 * Opening a preview wakes it. Re-read once it has had time to start, then once more for slow
 * starts. The first re-read lands after the server's 5 s per-origin cache has expired.
 */
const WAKE_RECHECK_DELAYS_MS = [6_000, 15_000] as const;
/** States kept for previews no row shows any more, so a remounting row does not flash. */
const MAX_REMEMBERED_STATES = 200;

type Statuses = PreviewLinkStatusResult["statuses"];
type States = ReadonlyMap<string, ThreadPreviewLinkState>;

const NO_STATES: States = new Map();

/** Reads the states of `urls` in one request; null when the environment could not answer. */
export type FetchPreviewLinkStatuses = (
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  urls: ReadonlyArray<string>,
) => Promise<Statuses | null>;

export interface PreviewLinkStates {
  /**
   * Keeps `urls` polled while mounted and reads the environment's known preview states.
   * A URL with no entry is not known yet; show it as `unknown`.
   */
  readonly statesAtom: (target: {
    readonly environmentId: EnvironmentId;
    readonly urls: ReadonlyArray<string>;
  }) => Atom.Atom<States>;
  /**
   * Re-reads previews soon after the user opens one, which wakes it. Without `urls`, every
   * preview currently shown in the environment.
   */
  readonly refresh: (environmentId: EnvironmentId, urls?: ReadonlyArray<string>) => void;
}

interface EnvironmentPoller {
  /** Mounted rows per URL. */
  readonly subscribers: Map<string, number>;
  /** URLs that gained their first row since the last read. */
  readonly pending: Set<string>;
  registry: AtomRegistry.AtomRegistry | null;
  interval: ReturnType<typeof setInterval> | null;
  flushQueued: boolean;
  wakeTimers: Array<ReturnType<typeof setTimeout>>;
}

/**
 * One poller per environment reads every mounted preview in a single request: every 30 s while
 * any row is mounted, right away when a new URL appears, and never with nothing mounted.
 */
export function createPreviewLinkStatesWith(fetchStatuses: FetchPreviewLinkStatuses) {
  const statesFamily = Atom.family((environmentId: EnvironmentId) =>
    Atom.make<States>(NO_STATES).pipe(
      Atom.keepAlive,
      Atom.withLabel(`environment-data:preview-links:states:${environmentId}`),
    ),
  );
  const pollers = new Map<EnvironmentId, EnvironmentPoller>();

  const pollerFor = (environmentId: EnvironmentId): EnvironmentPoller => {
    let poller = pollers.get(environmentId);
    if (poller === undefined) {
      poller = {
        subscribers: new Map(),
        pending: new Set(),
        registry: null,
        interval: null,
        flushQueued: false,
        wakeTimers: [],
      };
      pollers.set(environmentId, poller);
    }
    return poller;
  };

  const read = (environmentId: EnvironmentId, urls: ReadonlyArray<string>) => {
    const poller = pollers.get(environmentId);
    const registry = poller?.registry;
    if (!poller || !registry || urls.length === 0) return;
    void fetchStatuses(registry, environmentId, urls).then((statuses) => {
      if (statuses === null || statuses.length === 0) return;
      const atom = statesFamily(environmentId);
      const next = new Map(registry.get(atom));
      let changed = false;
      for (const { url, state } of statuses) {
        if (next.get(url) === state) continue;
        next.set(url, state);
        changed = true;
      }
      if (!changed) return;
      for (const url of next.keys()) {
        if (next.size <= MAX_REMEMBERED_STATES) break;
        if (!poller.subscribers.has(url)) next.delete(url);
      }
      registry.set(atom, next);
    });
  };

  const readAll = (environmentId: EnvironmentId) => {
    const poller = pollers.get(environmentId);
    if (poller) read(environmentId, [...poller.subscribers.keys()]);
  };

  // Rows mount together; one read covers every URL that appeared in the same tick.
  const queueFlush = (environmentId: EnvironmentId, poller: EnvironmentPoller) => {
    if (poller.flushQueued) return;
    poller.flushQueued = true;
    setTimeout(() => {
      poller.flushQueued = false;
      const urls = [...poller.pending].filter((url) => poller.subscribers.has(url));
      poller.pending.clear();
      read(environmentId, urls);
    }, 0);
  };

  const subscribe = (
    registry: AtomRegistry.AtomRegistry,
    environmentId: EnvironmentId,
    urls: ReadonlyArray<string>,
  ): (() => void) => {
    const poller = pollerFor(environmentId);
    poller.registry = registry;
    for (const url of urls) {
      const count = poller.subscribers.get(url) ?? 0;
      poller.subscribers.set(url, count + 1);
      if (count === 0) poller.pending.add(url);
    }
    if (poller.pending.size > 0) queueFlush(environmentId, poller);
    if (poller.interval === null && poller.subscribers.size > 0) {
      poller.interval = setInterval(() => readAll(environmentId), POLL_INTERVAL_MS);
    }
    return () => {
      for (const url of urls) {
        const count = poller.subscribers.get(url) ?? 0;
        if (count <= 1) poller.subscribers.delete(url);
        else poller.subscribers.set(url, count - 1);
      }
      if (poller.subscribers.size === 0) {
        if (poller.interval !== null) clearInterval(poller.interval);
        poller.interval = null;
        for (const timer of poller.wakeTimers) clearTimeout(timer);
        poller.wakeTimers = [];
      }
    };
  };

  // Mounting this keeps its URLs subscribed. It reads no other atom, so state updates never
  // remount it and churn the subscription.
  const subscriptionFamily = Atom.family((key: string) => {
    const [environmentId, urls] = JSON.parse(key) as [EnvironmentId, ReadonlyArray<string>];
    return Atom.make((get) => {
      get.addFinalizer(subscribe(get.registry, environmentId, urls));
      return null;
    }).pipe(Atom.withLabel(`environment-data:preview-links:subscription:${key}`));
  });

  const viewFamily = Atom.family((key: string) => {
    const [environmentId] = JSON.parse(key) as [EnvironmentId];
    return Atom.make((get) => {
      get(subscriptionFamily(key));
      return get(statesFamily(environmentId));
    }).pipe(Atom.withLabel(`environment-data:preview-links:view:${key}`));
  });

  const statesAtom: PreviewLinkStates["statesAtom"] = ({ environmentId, urls }) =>
    viewFamily(JSON.stringify([environmentId, [...new Set(urls)].sort()]));

  const refresh: PreviewLinkStates["refresh"] = (environmentId, urls) => {
    const poller = pollers.get(environmentId);
    if (!poller || poller.subscribers.size === 0) return;
    for (const timer of poller.wakeTimers) clearTimeout(timer);
    poller.wakeTimers = WAKE_RECHECK_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        if (urls === undefined) readAll(environmentId);
        else read(environmentId, urls);
      }, delay),
    );
  };

  return { statesAtom, refresh } satisfies PreviewLinkStates;
}

/** Preview states for web and mobile, read through the environment's WebSocket. */
export function createPreviewLinkStates<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
): PreviewLinkStates {
  const status = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:preview-links:status",
    tag: WS_METHODS.previewLinksStatus,
  });
  return createPreviewLinkStatesWith(async (registry, environmentId, urls) => {
    const result = await status.run(registry, { environmentId, input: { urls } });
    return AsyncResult.isSuccess(result) ? result.value.statuses : null;
  });
}
