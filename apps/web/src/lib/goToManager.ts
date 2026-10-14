import { setAppMode } from "../appMode";
import { closeHomeOverlay } from "../homeOverlayStore";
import { dispatchSnapShotComposerFocus } from "./desktopSnapShot";

const OPEN_POPUP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Home docks the manager from this width up; narrower windows show it as a page. */
const DOCKED_MANAGER_QUERY = "(min-width: 1024px)";

const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

function visibleOpenPopup(): Element | null {
  const popups = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].filter(
    (element) => element.closest("[inert]") === null && element.getClientRects().length > 0,
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
 * Lands the user in the Manager chat with its composer focused, from any
 * screen: popups close, the mode switch moves to Manager, and a window too
 * narrow for the docked manager gets the manager thread as a page. Already
 * there, it only focuses the composer.
 */
export async function goToManager(openManagerPage: () => Promise<void>): Promise<void> {
  await dismissOpenPopups();
  if (window.matchMedia(DOCKED_MANAGER_QUERY).matches) {
    setAppMode("classic");
  } else {
    closeHomeOverlay();
    await openManagerPage();
  }
  // The manager's view mounts on the next render; focus once it has.
  await nextFrame();
  dispatchSnapShotComposerFocus();
  await nextFrame();
  dispatchSnapShotComposerFocus();
}
