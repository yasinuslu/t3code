/**
 * Puts the manager on screen as the thread it is: the manager thread of the
 * profile in view, in the main column with the sidebar beside it. Carries out
 * the requests in `managerViewStore` (the shortcut, the app bar, the sidebar
 * row), and while a manager is showing, switching the space or the machine
 * shows that one's manager instead. Mounted once in the app shell.
 */
import { useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useIsManagerThread } from "../../brainstormStore";
import {
  closeHomeOverlay,
  holdHomeOverlayOpen,
  openHomeOverlay,
  useHomeOverlayStore,
} from "../../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { useManagerViewStore } from "../../managerViewStore";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { useEnsureManagerThread } from "./useOpenManagerThread";

// Longest Grow stays up for the manager to render before it gives way regardless.
const THREAD_VIEW_WAIT_MS = 1500;

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

/** Resolves once the thread view for `threadId` is on screen, or after a moment if it never is. */
async function threadViewRendered(threadId: string) {
  const deadline = performance.now() + THREAD_VIEW_WAIT_MS;
  while (
    document.querySelector(`[data-thread-view="${threadId}"]`) === null &&
    performance.now() < deadline
  ) {
    await nextFrame();
  }
}

async function focusComposer() {
  // The thread view mounts over the next frames; focus once it has.
  await nextFrame();
  dispatchSnapShotComposerFocus();
  await nextFrame();
  dispatchSnapShotComposerFocus();
}

export function ManagerRoute() {
  const route = useParams({ strict: false, select: (params) => resolveThreadRouteRef(params) });
  const onManager = useIsManagerThread(route?.environmentId ?? "", route?.threadId ?? "");
  const request = useManagerViewStore((state) => state.request);
  const router = useRouter();

  useEffect(() => {
    useManagerViewStore.setState({ shown: onManager });
  }, [onManager]);

  // Hiding goes back to where the manager was opened from.
  useEffect(() => {
    if (request !== "hide") return;
    const { returnTo } = useManagerViewStore.getState();
    useManagerViewStore.setState({ request: null, returnTo: null });
    // Grow goes back up once the page under it is there: Home closes on a path change.
    void router
      .navigate({ href: returnTo?.href ?? "/" })
      .then(nextFrame)
      .then(nextFrame)
      .then(() => {
        if (returnTo?.grow) openHomeOverlay();
      });
  }, [request, router]);

  // Finding the manager thread may create it, so it runs only when asked for or on screen.
  return request === "show" || onManager ? (
    <ManagerFollower currentKey={route ? `${route.environmentId}:${route.threadId}` : null} />
  ) : null;
}

function ManagerFollower(props: { readonly currentKey: string | null }) {
  const manager = useEnsureManagerThread();
  const navigate = useNavigate();
  const href = useLocation({ select: (location) => location.href });
  const request = useManagerViewStore((state) => state.request);
  const key = manager._tag === "Ready" ? `${manager.environmentId}:${manager.threadId}` : null;
  // The manager in view before; a change (another space or machine) is followed.
  const previousKey = useRef(key);

  useEffect(() => {
    const previous = previousKey.current;
    // A switch passes through loading; the last manager shown stays the one to compare with.
    if (key !== null) previousKey.current = key;
    // The live value: a second run before this render's request clears must not act again.
    if (request === "show" && useManagerViewStore.getState().request === "show") {
      if (manager._tag === "Failed") {
        // A space switched to while another profile's manager shows: show that space instead
        // (the index opens its most recent project), so the sidebar and the page agree.
        if (useManagerViewStore.getState().shown) {
          useManagerViewStore.setState({ request: null, returnTo: null });
          void navigate({ to: "/" });
        } else useManagerViewStore.setState({ request: null });
        toastManager.add({
          type: "warning",
          title: manager.offline ? "Manager host offline" : "The manager could not open",
          description: manager.message,
        });
        return;
      }
      if (manager._tag !== "Ready") return;
      const grow = useHomeOverlayStore.getState().open;
      useManagerViewStore.setState((state) => ({
        request: null,
        // Asking again while it shows keeps the way back to the page before it.
        returnTo: state.shown && !grow ? state.returnTo : { href, grow },
      }));
      if (props.currentKey !== key) {
        // Grow stays over the page until the manager is there, so the page under it
        // (Threads, a draft) never shows on the way.
        const release = holdHomeOverlayOpen();
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: manager.environmentId, threadId: manager.threadId },
        })
          .then(() => threadViewRendered(manager.threadId))
          .finally(() => {
            closeHomeOverlay();
            release();
          })
          .then(focusComposer);
      } else {
        closeHomeOverlay();
        void focusComposer();
      }
      return;
    }
    // Switching the space or the machine while a manager shows shows that one's manager.
    if (
      manager._tag === "Ready" &&
      previous !== null &&
      key !== previous &&
      props.currentKey !== key
    ) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: manager.environmentId, threadId: manager.threadId },
        replace: true,
      });
    }
  }, [href, key, manager, navigate, props.currentKey, request]);

  return null;
}
