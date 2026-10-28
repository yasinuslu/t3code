/**
 * Puts the manager on screen as the thread it is: the manager thread of the
 * profile in view, in the main column with the sidebar beside it. Carries out
 * the requests in `managerViewStore` (the shortcut, the app bar, the sidebar
 * row), and while a manager is showing, switching the space or the machine
 * shows that one's manager instead. Mounted once in the app shell.
 */
import { useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useIsManagerThread } from "../../brainstormStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { returnFromManager } from "../../lib/goToManager";
import { useManagerViewStore } from "../../managerViewStore";
import { useThreadShell } from "../../state/entities";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { useEnsureManagerThread } from "./useOpenManagerThread";

// Longest Grow stays up for the manager to render before it gives way regardless.
const THREAD_VIEW_WAIT_MS = 1500;
// Longest a just-created manager is waited for to reach this client before it is opened anyway.
const THREAD_SHELL_WAIT_MS = 5000;

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes whether the manager is shown to the view store
  useEffect(() => {
    useManagerViewStore.setState({ shown: onManager });
  }, [onManager]);

  // Hiding goes back to where the manager was opened from.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- navigates the router back when the manager is hidden
  useEffect(() => {
    if (request !== "hide") return;
    const { returnTo } = useManagerViewStore.getState();
    useManagerViewStore.setState({ request: null, returnTo: null });
    void returnFromManager(returnTo, (href) => router.navigate({ href }));
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
  // A manager just created is known to the server before this client has its thread; the
  // thread route sends a thread it does not have home, so the way there waits for it.
  const shellKnown =
    useThreadShell(
      manager._tag === "Ready"
        ? { environmentId: manager.environmentId, threadId: manager.threadId }
        : null,
    ) !== null;
  const [shellWaitedOut, setShellWaitedOut] = useState(false);
  const waitingForShell = key !== null && !shellKnown;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- times out the wait for the thread shell
  useEffect(() => {
    if (!waitingForShell) return;
    const timer = setTimeout(() => setShellWaitedOut(true), THREAD_SHELL_WAIT_MS);
    return () => {
      clearTimeout(timer);
      setShellWaitedOut(false);
    };
  }, [waitingForShell]);
  // The manager in view before; a change (another space or machine) is followed.
  const previousKey = useRef(key);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- navigates the router to follow the manager thread
  useEffect(() => {
    const previous = previousKey.current;
    // A switch passes through loading; the last manager shown stays the one to compare with.
    // It only moves on once the manager can be shown, so a switch waiting for its thread is still followed.
    if (key !== null && (shellKnown || shellWaitedOut)) previousKey.current = key;
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
      if (!shellKnown && !shellWaitedOut) return;
      useManagerViewStore.setState((state) => ({
        request: null,
        // Asking again while it shows keeps the way back to the page before it.
        returnTo: state.shown ? state.returnTo : { href },
      }));
      if (props.currentKey !== key) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: manager.environmentId, threadId: manager.threadId },
        })
          .then(() => threadViewRendered(manager.threadId))
          .catch(() => undefined)
          .then(focusComposer);
      } else {
        void focusComposer();
      }
      return;
    }
    // Switching the space or the machine while a manager shows shows that one's manager.
    if (
      manager._tag === "Ready" &&
      (shellKnown || shellWaitedOut) &&
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
  }, [href, key, manager, navigate, props.currentKey, request, shellKnown, shellWaitedOut]);

  return null;
}
