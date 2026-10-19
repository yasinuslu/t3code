/**
 * The manager is a thread: showing it opens the manager thread of the profile
 * in view, in the main column next to the sidebar. Code outside React asks
 * for that here; `ManagerRoute` (mounted once in the app shell) does the
 * navigating, since only it knows the manager thread and has the router.
 */
import { create } from "zustand";

interface ManagerViewStore {
  /** Whether the route shows a manager thread. Kept current by `ManagerRoute`. */
  readonly shown: boolean;
  /** A pending request from the shortcut, the app bar or the sidebar row. */
  readonly request: "show" | "hide" | null;
  /** Where hiding the manager goes back to: the page and whether Grow was over it. */
  readonly returnTo: { readonly href: string; readonly grow: boolean } | null;
}

export const useManagerViewStore = create<ManagerViewStore>()(() => ({
  shown: false,
  request: null,
  returnTo: null,
}));

export const requestManagerShown = () => useManagerViewStore.setState({ request: "show" });
export const requestManagerHidden = () => useManagerViewStore.setState({ request: "hide" });
