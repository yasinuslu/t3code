import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

/** The background command whose details are open; the thread panel and the activity line open it. */
export interface BackgroundCommandTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly taskId: string;
}

interface BackgroundCommandDialogState {
  readonly target: BackgroundCommandTarget | null;
  readonly open: (target: BackgroundCommandTarget) => void;
  readonly close: () => void;
}

export const useBackgroundCommandDialogStore = create<BackgroundCommandDialogState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openBackgroundCommand(target: BackgroundCommandTarget) {
  useBackgroundCommandDialogStore.getState().open(target);
}
