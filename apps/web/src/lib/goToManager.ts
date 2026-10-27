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
 * screen, with its composer focused. Popups in the way close first.
 */
export async function openManager(): Promise<void> {
  await dismissOpenPopups();
  requestManagerShown();
}

/** The manager shortcut: shows the manager, or goes back to where it was opened from. */
export function toggleManager(): void {
  if (useManagerViewStore.getState().shown) requestManagerHidden();
  else void openManager();
}

/** Hides the manager by going back to the page it was opened from. */
export async function returnFromManager(
  returnTo: ManagerReturn | null,
  navigate: (href: string) => Promise<unknown>,
): Promise<void> {
  try {
    await navigate(returnTo?.href ?? "/");
  } catch {
    // The manager stays where it is.
  }
}
