/**
 * A decision waits a few seconds before it runs, with Undo in a toast: a
 * mis-tap in bed must not ship anything. Kept outside React so leaving Grow
 * inside the window still runs it, and so the deck can hide what is pending.
 */
import { create } from "zustand";

import { toastManager } from "../ui/toast";

export const UNDO_WINDOW_MS = 5_000;

interface PendingDecision {
  readonly timer: number;
  readonly toastId: string;
}

const pending = new Map<string, PendingDecision>();

/** The keys inside their undo window; the deck leaves them out. */
export const usePendingDecisions = create<{ readonly keys: ReadonlySet<string> }>(() => ({
  keys: new Set(),
}));

const publish = () => usePendingDecisions.setState({ keys: new Set(pending.keys()) });

/** The most recent decision still undoable, for the `u` key. */
let latest: string | null = null;

export function decide(input: {
  readonly key: string;
  /** What the toast says is about to happen, e.g. "Shipping Studio upgrade". */
  readonly title: string;
  readonly run: () => Promise<void>;
}) {
  undo(input.key);
  const toastId = toastManager.add({
    type: "info",
    title: input.title,
    timeout: UNDO_WINDOW_MS,
    actionProps: { children: "Undo", onClick: () => undo(input.key) },
    data: { hideCopyButton: true },
  });
  const timer = window.setTimeout(() => {
    pending.delete(input.key);
    if (latest === input.key) latest = null;
    void input.run().finally(publish);
  }, UNDO_WINDOW_MS);
  pending.set(input.key, { timer, toastId });
  latest = input.key;
  publish();
}

export function undo(key: string | null = latest): boolean {
  if (key === null) return false;
  const entry = pending.get(key);
  if (entry === undefined) return false;
  window.clearTimeout(entry.timer);
  toastManager.close(entry.toastId);
  pending.delete(key);
  if (latest === key) latest = null;
  publish();
  return true;
}
