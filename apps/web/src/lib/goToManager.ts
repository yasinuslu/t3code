import { focusManagerInGrow } from "../growFocus";
import {
  growIsHome,
  holdHomeOverlayOpen,
  openHomeOverlay,
  useHomeOverlayStore,
} from "../homeOverlayStore";
import {
  type ManagerReturn,
  requestManagerHidden,
  requestManagerShown,
  useManagerViewStore,
} from "../managerViewStore";

// Toasts are non-modal dialogs and are not in the way.
const OPEN_POPUP_SELECTOR =
  '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"], [role="menu"], [role="listbox"]';

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

function visibleOpenPopup(): Element | null {
  const popups = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].filter(
    (element) =>
      element.closest("[inert]") === null &&
      // Toasts are dialogs to assistive tech but never hold the keyboard.
      element.closest('[data-slot="toast-viewport"]') === null &&
      element.getClientRects().length > 0,
  );
  return popups.at(-1) ?? null;
}

/**
 * Closes the dialogs, menus and the command palette in the way. Escape goes to
 * the popup itself, never to the composer, where it would stop a running turn.
 */
async function dismissOpenPopups(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const popup = visibleOpenPopup();
    if (popup === null) return;
    popup.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextFrame();
  }
}

/**
 * Opens the manager thread of the profile in view next to the sidebar, from any
 * screen (Grow too), with its composer focused. Popups in the way close first.
 */
export async function openManager(): Promise<void> {
  await dismissOpenPopups();
  // With Grow as the main view, the manager is Grow's own pane.
  if (growIsHome()) {
    focusManagerInGrow();
    openHomeOverlay();
    return;
  }
  requestManagerShown();
}

// Set while a way back to Grow is under way, when the route still shows the manager.
let returning = false;

// Grow shows the manager in its own pane, next to its list; set while Grow is up.
let growManagerToggle: (() => void) | null = null;

/** Grow registers how the shortcut shows and hides its manager pane; returns the unregister. */
export function setGrowManagerToggle(toggle: () => void): () => void {
  growManagerToggle = toggle;
  return () => {
    if (growManagerToggle === toggle) growManagerToggle = null;
  };
}

/**
 * The manager shortcut: shows the manager, or goes back to where it was opened
 * from. Over Grow it is the same as M there: the manager in Grow's own pane.
 */
export function toggleManager(): void {
  // A second press before the page is back would otherwise ask for the manager again.
  if (returning) return;
  if (growManagerToggle !== null && useHomeOverlayStore.getState().open) {
    void dismissOpenPopups().then(() => growManagerToggle?.());
    return;
  }
  if (growIsHome()) {
    void openManager();
    return;
  }
  // Under Grow the manager is not what shows, so the shortcut brings it up.
  if (useManagerViewStore.getState().shown && !useHomeOverlayStore.getState().open) {
    requestManagerHidden();
  } else void openManager();
}

/**
 * Hides the manager by going back to where it was opened from. Grow comes back
 * at once and is held over the page while that changes underneath: waiting for
 * the page to load first left the manager on screen, unresponsive, for as long
 * as that took.
 */
export async function returnFromManager(
  returnTo: ManagerReturn | null,
  navigate: (href: string) => Promise<unknown>,
): Promise<void> {
  const release = returnTo?.grow ? holdHomeOverlayOpen() : null;
  returning = returnTo?.grow === true;
  if (returnTo?.grow) openHomeOverlay();
  try {
    await navigate(returnTo?.href ?? "/");
    // Home closes on a path change in an effect that runs a frame after it.
    await nextFrame();
    await nextFrame();
  } catch {
    // The manager stays where it is; Grow, if it was asked for, is still up.
  } finally {
    returning = false;
    release?.();
  }
}
