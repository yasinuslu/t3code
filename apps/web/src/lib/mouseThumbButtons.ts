import { useEffect, useRef } from "react";

/**
 * Mouse thumb buttons step through a list while the pointer is over the
 * region matching `regionSelector`: back (3) is -1, forward (4) is +1.
 * Elsewhere they keep their default. Capture phase, and every event of the
 * press is swallowed, so neither rows inside the region nor Chromium's own
 * back/forward handling can act on it; the step runs once, on mouseup.
 */
export function useMouseThumbButtons(
  regionSelector: string,
  onStep: (direction: 1 | -1) => void,
): void {
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (!(event.target instanceof Element) || !event.target.closest(regionSelector)) return;
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
  }, [regionSelector]);
}
