import { useEffect, useRef } from "react";

import { isEditableFocused } from "../../lib/editableFocus";
import { type GrowBoard, growStepFocus } from "./grow.logic";
import { useGrowFocusStore } from "./grow.store";

/** Same idea as HomeOverlay's: a popup owns the keyboard while it is open. */
const OPEN_POPUP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Board keys: j/k (or the arrows) step through the cards, Esc leaves focus
 * mode, m toggles the dock and p/o pick the center tab. Every one of them
 * also has a visible control; keys typed into the prototype's iframe never
 * reach this, which is why.
 */
export function useGrowShortcuts(
  board: GrowBoard,
  options: { readonly enabled: boolean; readonly canPlay: boolean },
) {
  const latest = useRef({ board, ...options });
  useEffect(() => {
    latest.current = { board, ...options };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { board, enabled, canPlay } = latest.current;
      if (!enabled || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableFocused(event.target)) return;
      const openPopup = [...document.querySelectorAll(OPEN_POPUP_SELECTOR)].some(
        (element) => element.closest("[inert]") === null,
      );
      if (openPopup) return;
      const store = useGrowFocusStore.getState();
      const focused = store.focusedKey !== null;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      switch (event.key) {
        case "j":
        case "ArrowDown":
        case "k":
        case "ArrowUp": {
          const next = growStepFocus(
            board,
            store.focusedKey,
            event.key === "j" || event.key === "ArrowDown" ? 1 : -1,
          );
          if (next === null) return;
          handled();
          store.setFocusedKey(next);
          return;
        }
        case "Escape":
          if (!focused) return;
          handled();
          store.setFocusedKey(null);
          return;
        case "m":
          if (!focused) return;
          handled();
          store.setDockTab(store.dockTab === "thread" ? "manager" : "thread");
          return;
        case "p":
          if (!focused || !canPlay) return;
          handled();
          store.setCenterTab("play");
          return;
        case "o":
          if (!focused) return;
          handled();
          store.setCenterTab("overview");
          return;
      }
    };
    // Capture phase, so Esc leaves focus mode before HomeOverlay's handler can close Home.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
