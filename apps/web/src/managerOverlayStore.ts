/**
 * Whether the manager overlay is open. The manager chat floats over whatever
 * screen is showing (Grow, a thread, settings); one shortcut toggles it.
 */
import { create } from "zustand";

interface ManagerOverlayStore {
  readonly open: boolean;
}

export const useManagerOverlayStore = create<ManagerOverlayStore>()(() => ({ open: false }));

export const openManagerOverlay = () => useManagerOverlayStore.setState({ open: true });
export const closeManagerOverlay = () => useManagerOverlayStore.setState({ open: false });
export const toggleManagerOverlay = () =>
  useManagerOverlayStore.setState((state) => ({ open: !state.open }));
