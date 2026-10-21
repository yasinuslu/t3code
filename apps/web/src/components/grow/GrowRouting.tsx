/**
 * Thread links open in Grow. Every way to a thread (a `t3code://` link, a notification,
 * a link in a message, the command palette, a pull request's thread) ends in a navigation
 * to the thread's route; when one lands, Grow comes up showing that thread. The thread
 * page itself is the full view, reached only on purpose (`openFullView`). Mounted once in
 * the app shell; does nothing while the classic threads view is on.
 */
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import {
  focusThreadInGrow,
  growOnScreenThread,
  setFullViewOpener,
  useGrowFocusStore,
} from "../../growFocus";
import {
  closeHomeOverlay,
  growIsHome,
  homeOverlayHeldOpen,
  markFullViewNavigation,
  openHomeOverlay,
  reloadedInFullView,
  takeFullViewNavigation,
} from "../../homeOverlayStore";
import { resolveThreadRouteRef } from "../../threadRoutes";

export function GrowRouting() {
  const router = useRouter();
  // The resolved location, not the requested one: its matches (and so its params) are in place.
  const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname ?? null });
  const previous = useRef<string | null>(null);

  useEffect(
    () =>
      setFullViewOpener((thread) => {
        closeHomeOverlay();
        const params = { environmentId: thread.environmentId, threadId: thread.threadId };
        // Already on that route (Grow keeps it in step with what it shows): closing is enough.
        const current = resolveThreadRouteRef(router.state.matches.at(-1)?.params ?? {});
        if (
          current?.environmentId === thread.environmentId &&
          current.threadId === thread.threadId
        ) {
          return;
        }
        markFullViewNavigation();
        void router.navigate({ to: "/$environmentId/$threadId", params });
      }),
    [router],
  );

  useEffect(() => {
    const before = previous.current;
    previous.current = pathname;
    if (pathname === null || before === pathname) return;
    land(router.state.matches.at(-1)?.params ?? {}, before);
    useGrowFocusStore.setState({ landed: true });
  }, [pathname, router]);

  return null;
}

/** Brings up the thread a navigation landed on, unless the navigation is one Grow stays out of. */
function land(params: Parameters<typeof resolveThreadRouteRef>[0], before: string | null) {
  const fullView = takeFullViewNavigation();
  const route = resolveThreadRouteRef(params);
  if (!growIsHome() || route === null || fullView) return;
  // A reload of a full view stays there; so does a draft becoming its thread once sent.
  if (before === null && reloadedInFullView()) return;
  if (before?.startsWith("/draft/")) return;
  // A hop under way (the manager's page) owns where it lands.
  if (homeOverlayHeldOpen()) return;
  const key = `${route.environmentId}:${route.threadId}`;
  const shown = growOnScreenThread();
  if (shown !== null && `${shown.environmentId}:${shown.threadId}` === key) return;
  focusThreadInGrow(key);
  openHomeOverlay();
}
