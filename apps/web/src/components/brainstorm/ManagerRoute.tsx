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
import { closeHomeOverlay, openHomeOverlay, useHomeOverlayStore } from "../../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { useManagerViewStore } from "../../managerViewStore";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { useEnsureManagerThread } from "./useOpenManagerThread";

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

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
    router.history.push(returnTo?.href ?? "/");
    if (returnTo?.grow) openHomeOverlay();
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
    if (request === "show") {
      if (manager._tag === "Failed") {
        useManagerViewStore.setState({ request: null });
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
      closeHomeOverlay();
      if (props.currentKey !== key) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: manager.environmentId, threadId: manager.threadId },
        }).then(focusComposer);
      } else void focusComposer();
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
