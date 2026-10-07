import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

/** The background command whose details are open; the composer bar, timeline, and thread details all open it. */
export interface BackgroundCommandTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly taskId: string;
}

interface BackgroundCommandsDialogState {
  readonly target: BackgroundCommandTarget | null;
  readonly open: (target: BackgroundCommandTarget) => void;
  readonly close: () => void;
}

export const useBackgroundCommandsDialogStore = create<BackgroundCommandsDialogState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openBackgroundCommand(target: BackgroundCommandTarget) {
  useBackgroundCommandsDialogStore.getState().open(target);
}
