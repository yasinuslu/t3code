import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { isEditableFocused, isInlineComponentEvent } from "../lib/editableFocus";

/** Returns to the previous app page, or home when opened without app history. */
function useNavigateBack() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  return useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);
}

/**
 * Enables page-level Escape navigation, letting controls consume Escape first. Escape from an
 * inline component or a shadow-DOM input stays with it; Mod+[ is the always-available Back.
 */
export function useEscapeToGoBack(onEscape?: () => void) {
  const navigateBack = useNavigateBack();
  const handleEscape = onEscape ?? navigateBack;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Escape")
        return;
      if (isInlineComponentEvent(event) || isEditableFocused(document.activeElement)) return;
      event.preventDefault();

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }

      handleEscape();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleEscape]);
}
