import { useLocation } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";

import {
  OverlayLayerContext,
  closeHomeOverlay,
  homeOverlayHeldOpen,
  inStartupHops,
  useHomeOverlayStore,
} from "../../homeOverlayStore";
import { MARKDOWN_FILE_LINK_CLASS_NAME } from "../../markdown-links";
import { HomeDashboard } from "./HomeDashboard";

/**
 * Home as a full-window layer over the app. The page underneath stays
 * mounted (and inert while covered), so closing Home is simply removing this
 * layer. Mounted once in the app shell; renders nothing while closed.
 */
export function HomeOverlay() {
  const open = useHomeOverlayStore((state) => state.open);
  return open ? <HomeOverlayLayer /> : null;
}

function HomeOverlayLayer() {
  const layerRef = useRef<HTMLDivElement>(null);

  // Cover the page: make it inert, and give focus back where it was on close.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer?.parentElement) return;
    const previousFocus = document.activeElement;
    const covered = [...layer.parentElement.children].filter(
      (element): element is HTMLElement =>
        element !== layer &&
        element instanceof HTMLElement &&
        !element.inert &&
        // The mode switch floats above Home and has to stay clickable.
        !element.hasAttribute("data-mode-switch"),
    );
    for (const element of covered) element.inert = true;
    return () => {
      for (const element of covered) element.inert = false;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // Navigating anywhere (a card, a link in a chat's answer, a shortcut)
  // shows the destination. /home opens Home and goes to the start page, which
  // redirects on by itself; those hops keep Home open.
  const pathname = useLocation({ select: (location) => location.pathname });
  const previousPathname = useRef(pathname);
  useEffect(() => {
    const before = previousPathname.current;
    previousPathname.current = pathname;
    if (inStartupHops() || homeOverlayHeldOpen()) return;
    if (before !== pathname && before !== "/home" && before !== "/") closeHomeOverlay();
  }, [pathname]);

  // A link to the thread already underneath does not change the path. File
  // chips are anchors to host paths that open in the chat's own panel, so
  // they keep Home open. Esc never closes Home: Grow is a screen, not a popup.
  const onClickCapture = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (
      anchor instanceof HTMLAnchorElement &&
      anchor.target !== "_blank" &&
      anchor.origin === window.location.origin &&
      !anchor.classList.contains(MARKDOWN_FILE_LINK_CLASS_NAME)
    ) {
      closeHomeOverlay();
    }
  };

  return (
    <OverlayLayerContext value={1}>
      <div
        ref={layerRef}
        data-home-overlay=""
        aria-label="Home"
        className="home-overlay fixed inset-0 z-40 flex flex-col bg-background"
        onClickCapture={onClickCapture}
      >
        <HomeDashboard />
      </div>
    </OverlayLayerContext>
  );
}
