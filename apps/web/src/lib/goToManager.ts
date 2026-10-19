import {
  closeManagerOverlay,
  openManagerOverlay,
  useManagerOverlayStore,
} from "../managerOverlayStore";
import { dispatchSnapShotComposerFocus } from "./desktopSnapShot";

// Toasts are non-modal dialogs and are not in the way.
const OPEN_POPUP_SELECTOR =
  '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"], [role="menu"], [role="listbox"]';

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

function visibleOpenPopup(): Element | null {
  const popups = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].filter(
    (element) =>
      element.closest("[inert]") === null &&
      element.closest("[data-manager-overlay]") === null &&
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
 * Shows the manager over whatever screen is open, with its composer focused.
 * Popups in the way close first. Already open, it only focuses the composer.
 */
export async function openManager(): Promise<void> {
  await dismissOpenPopups();
  openManagerOverlay();
  // The manager's view mounts on the next render; focus once it has.
  await nextFrame();
  dispatchSnapShotComposerFocus();
  await nextFrame();
  dispatchSnapShotComposerFocus();
}

/** The manager shortcut: shows the manager, or puts it away when it is showing. */
export function toggleManager(): void {
  if (useManagerOverlayStore.getState().open) closeManagerOverlay();
  else void openManager();
}
