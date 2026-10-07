import { useLocation } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";

import {
  InHomeOverlayContext,
  closeHomeOverlay,
  useHomeOverlayStore,
} from "../../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { isEditableFocused } from "../../lib/editableFocus";
import { HomeDashboard } from "./HomeDashboard";

const OPEN_POPUP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const COMPOSER_EDITOR_SELECTOR = '[data-testid="composer-editor"]';

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
        element !== layer && element instanceof HTMLElement && !element.inert,
    );
    for (const element of covered) element.inert = true;
    return () => {
      for (const element of covered) element.inert = false;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // The manager composer takes focus once its view has subscribed.
  useEffect(() => {
    const frame = window.requestAnimationFrame(dispatchSnapShotComposerFocus);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Navigating anywhere (a card, a link in the manager's answer, a shortcut)
  // shows the destination. /home opens Home and goes to the start page, which
  // redirects on by itself; those hops keep Home open.
  const pathname = useLocation({ select: (location) => location.pathname });
  const previousPathname = useRef(pathname);
  useEffect(() => {
    const before = previousPathname.current;
    previousPathname.current = pathname;
    if (before !== pathname && before !== "/home" && before !== "/") closeHomeOverlay();
  }, [pathname]);

  // Esc closes Home unless something in it handles Esc itself (composer
  // menus, popups, a running turn's stop) or a text field other than the
  // manager composer, whose draft is kept anyway, has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const openPopup = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].some(
        (element) => element.closest("[inert]") === null,
      );
      if (openPopup) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isEditableFocused(target) && target?.closest(COMPOSER_EDITOR_SELECTOR) === null) return;
      event.preventDefault();
      closeHomeOverlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A link to the thread already underneath does not change the path.
  const onClickCapture = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (
      anchor instanceof HTMLAnchorElement &&
      anchor.target !== "_blank" &&
      anchor.origin === window.location.origin
    ) {
      closeHomeOverlay();
    }
  };

  return (
    <InHomeOverlayContext value={true}>
      <div
        ref={layerRef}
        data-home-overlay=""
        aria-label="Home"
        className="home-overlay fixed inset-0 z-40 flex flex-col bg-background"
        onClickCapture={onClickCapture}
      >
        <HomeDashboard />
      </div>
    </InHomeOverlayContext>
  );
}
