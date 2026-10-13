import { useEffect, useRef } from "react";

import { isEditableFocused } from "../../lib/editableFocus";
import {
  GROW_MANAGER_KEY,
  type GrowBoard,
  growEffectiveSelection,
  growStepSelection,
} from "./grow.logic";
import { useGrowStore } from "./grow.store";

/** Same idea as HomeOverlay's: a popup owns the keyboard while it is open. */
const OPEN_POPUP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Board keys: j/k (or the arrows) step through the cards, b switches the left
 * side between Threads and Board, m selects the manager (and back), p/o pick
 * the thing's tab, and Esc goes from Threads to Board (in Board it is left
 * alone, so Home closes). Every one also has a visible control; keys typed
 * into the prototype's iframe never reach this, which is why.
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
      const store = useGrowStore.getState();
      const selected = growEffectiveSelection(board, store.selected);
      const onCard = selected !== GROW_MANAGER_KEY;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      switch (event.key) {
        case "j":
        case "ArrowDown":
        case "k":
        case "ArrowUp":
          handled();
          store.select(
            growStepSelection(
              board,
              selected,
              event.key === "j" || event.key === "ArrowDown" ? 1 : -1,
            ),
          );
          return;
        case "b":
          handled();
          store.setLeftMode(store.leftMode === "threads" ? "board" : "threads");
          return;
        case "m":
          handled();
          store.toggleManager();
          return;
        case "p":
          if (!onCard || !canPlay) return;
          handled();
          store.setThingTab("play");
          store.setLeftMode("threads");
          return;
        case "o":
          if (!onCard) return;
          handled();
          store.setThingTab("overview");
          store.setLeftMode("threads");
          return;
        case "Escape":
          // Capture phase, so this runs before HomeOverlay's handler could close Home.
          if (store.leftMode !== "threads") return;
          handled();
          store.setLeftMode("board");
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
