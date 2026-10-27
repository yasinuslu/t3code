import { useEffect, useRef } from "react";

/**
 * Capture-phase listener for the mouse thumb buttons: back (3) is -1, forward
 * (4) is +1. For a press where `claims(target)` holds, every event of the
 * press is swallowed, so neither rows under the pointer nor Chromium's own
 * back/forward handling can act on it; the step runs once, on mouseup.
 */
function useThumbButtons(
  claims: (target: Element) => boolean,
  onStep: (direction: 1 | -1) => void,
): void {
  const onStepRef = useRef(onStep);
  const claimsRef = useRef(claims);
  useEffect(() => {
    onStepRef.current = onStep;
    claimsRef.current = claims;
  }, [onStep, claims]);
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (!(event.target instanceof Element) || !claimsRef.current(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "mouseup") onStepRef.current(event.button === 3 ? -1 : 1);
    };
    // Pointer events are left alone: preventing pointerdown would suppress
    // the mouseup this acts on.
    const types = ["mousedown", "mouseup", "auxclick"] as const;
    for (const type of types) window.addEventListener(type, handle, true);
    return () => {
      for (const type of types) window.removeEventListener(type, handle, true);
    };
  }, []);
}

/** Thumb buttons step through a list while the pointer is over `regionSelector`. */
export function useMouseThumbButtons(
  regionSelector: string,
  onStep: (direction: 1 | -1) => void,
): void {
  useThumbButtons((target) => target.closest(regionSelector) !== null, onStep);
}

/**
 * Thumb buttons act as browser back/forward through the router history
 * everywhere except over the regions matching `claimedSelector`, which use
 * them for their own stepping (see `useMouseThumbButtons`). Done explicitly
 * because the desktop shell has no built-in mouse navigation on every platform.
 */
export function useMouseHistoryButtons(
  claimedSelector: string,
  onStep: (direction: 1 | -1) => void,
): void {
  useThumbButtons((target) => target.closest(claimedSelector) === null, onStep);
}
