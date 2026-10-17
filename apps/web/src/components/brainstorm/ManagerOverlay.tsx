/**
 * The manager chat as a floating layer over the whole app: Grow, a thread or
 * settings. One shortcut (`manager.toggle`) shows and hides it, and so does Esc.
 * It is the real thread view of the profile's single manager thread, so a draft
 * left in its composer is still there on the next open. Mounted once in the app
 * shell; renders nothing while closed.
 */
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import { CloudOffIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";

import { OverlayLayerContext } from "../../homeOverlayStore";
import { shortcutLabelForCommand } from "../../keybindings";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import { closeManagerOverlay, useManagerOverlayStore } from "../../managerOverlayStore";
import { MARKDOWN_FILE_LINK_CLASS_NAME } from "../../markdown-links";
import { primaryServerKeybindingsAtom } from "../../state/server";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ManagerMachineSwitcher } from "./ManagerMachineSwitcher";
import { ManagerProfileSwitcher } from "./ManagerProfileSwitcher";
import { selectManagerProfile, useEnsureManagerThread } from "./useOpenManagerThread";

const OPEN_POPUP_SELECTOR =
  '[role="dialog"]:not([data-manager-overlay]), [role="alertdialog"], [role="menu"], [role="listbox"]';

export function ManagerOverlay() {
  const open = useManagerOverlayStore((state) => state.open);
  return open ? <ManagerOverlayLayer /> : null;
}

function ManagerOverlayLayer() {
  const layerRef = useRef<HTMLDivElement>(null);
  const manager = useEnsureManagerThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "manager.toggle");

  // Cover the app: make it inert, and give focus back where it was on close.
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

  // The composer takes focus once the thread view has subscribed.
  const ready = manager._tag === "Ready";
  useEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(dispatchSnapShotComposerFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [ready]);

  // Navigating anywhere (a thread link in the manager's answer) shows the destination.
  const pathname = useLocation({ select: (location) => location.pathname });
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedAt.current) closeManagerOverlay();
  }, [pathname]);

  // Esc hides the manager unless something in it handles Esc first: a composer
  // menu, a popup, or a running turn's stop (those mark the event handled).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const openPopup = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].some(
        (element) => element.closest("[inert]") === null && element.getClientRects().length > 0,
      );
      if (openPopup) return;
      event.preventDefault();
      closeManagerOverlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A link to the thread already underneath does not change the path. File
  // chips open in the manager's own panel, so they keep it open.
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
      closeManagerOverlay();
    }
  };

  return (
    <OverlayLayerContext value={2}>
      <div
        ref={layerRef}
        className="manager-overlay fixed inset-0 z-55 flex items-center justify-center bg-black/40 sm:p-6"
        onClickCapture={onClickCapture}
        onPointerDown={(event) => {
          // A press on the dimmed backdrop, not inside the panel, puts the manager away.
          if (event.target === event.currentTarget) closeManagerOverlay();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Manager"
          data-manager-overlay=""
          className="flex h-full w-full max-w-6xl min-h-0 flex-col overflow-hidden bg-background shadow-2xl sm:h-[min(56rem,100%)] sm:rounded-2xl sm:border"
        >
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <h2 className="font-medium text-sm">Manager</h2>
            <ManagerProfileSwitcher includeAll onSelect={selectManagerProfile} />
            <ManagerMachineSwitcher />
            <div className="ms-auto flex shrink-0 items-center gap-2">
              {shortcut ? (
                <span className="text-muted-foreground text-xs max-sm:hidden">
                  {shortcut} or Esc to hide
                </span>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Hide manager"
                onClick={closeManagerOverlay}
              >
                <XIcon />
              </Button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">
            {manager._tag === "Ready" ? (
              <ChatView
                key={`${manager.environmentId}:${manager.threadId}`}
                environmentId={manager.environmentId}
                threadId={manager.threadId}
                routeKind="server"
                reserveTitleBarControlInset={false}
                autoFocusComposer
                embedded
              />
            ) : manager._tag === "Failed" ? (
              <ManagerUnavailable message={manager.message} offline={manager.offline} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Spinner />
              </div>
            )}
          </div>
        </div>
      </div>
    </OverlayLayerContext>
  );
}

/** The manager's machine is offline or not connected: say so, and what still works. */
export function ManagerUnavailable(props: { readonly message: string; readonly offline: boolean }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
      data-manager-unavailable=""
    >
      <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium text-sm">
        {props.offline ? "Manager host offline" : "The manager could not open"}
      </p>
      <p className="max-w-sm text-muted-foreground text-sm">{props.message}</p>
      {props.offline ? (
        <p className="max-w-sm text-muted-foreground text-xs">
          It comes back here by itself once that machine reconnects. Your other threads keep
          working.
        </p>
      ) : null}
    </div>
  );
}
