import { enterPane } from "../../lib/paneFocus";
import type { GrowZone } from "./grow.keys";

/**
 * The places on the Grow screen the number keys jump to. Each is an element marked
 * `data-grow-zone="<zone>"`; a zone may take a few frames to appear (the live app loads,
 * the conversation opens), so a jump waits for it before giving up.
 */
const ZONE = "data-grow-zone";
const PAGE = "webview, iframe";

export function zoneOf(target: EventTarget | null): GrowZone | null {
  if (!(target instanceof Element)) return null;
  const zone = target.closest(`[${ZONE}]`)?.getAttribute(ZONE);
  return zone === "threads" || zone === "presentation" || zone === "live" || zone === "chat"
    ? zone
    : null;
}

function zoneElement(zone: GrowZone): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[${ZONE}="${zone}"]`);
  return element !== null && element.getClientRects().length > 0 ? element : null;
}

/** Focus lands in the zone: the current row, the composer, the live page, the presentation. */
function enterZone(zone: GrowZone): boolean {
  const element = zoneElement(zone);
  if (element === null) return false;
  if (zone === "live") {
    const page = element.querySelector<HTMLElement>(PAGE);
    if (page === null) return false;
    page.focus();
    return true;
  }
  if (zone === "threads") {
    // The thread on screen; when its project is folded away, the list itself, so W and S
    // keep working. Never the search field above the list.
    const row = element.querySelector<HTMLElement>(
      '[data-pane-row][aria-current]:not([aria-current="false"])',
    );
    if (row !== null) {
      row.focus();
      return true;
    }
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
    element.focus({ preventScroll: true });
    return true;
  }
  if (zone === "presentation" && !element.hasAttribute("tabindex")) {
    // The presentation is read and scrolled, not typed in: it takes focus itself.
    element.setAttribute("tabindex", "-1");
  }
  if (zone === "presentation") element.focus({ preventScroll: true });
  else enterPane(element);
  return true;
}

let pendingJump = 0;

/** Moves focus into a zone once it is on screen, trying for about a second. */
export function focusZone(zone: GrowZone): void {
  const jump = ++pendingJump;
  let frames = 60;
  const attempt = () => {
    // A later jump wins over one still waiting.
    if (jump !== pendingJump) return;
    if (enterZone(zone) || --frames <= 0) return;
    requestAnimationFrame(attempt);
  };
  attempt();
}

/** The zone that holds focus now, or null when focus is nowhere in Grow. */
export function activeZone(): GrowZone | null {
  return zoneOf(document.activeElement);
}

/**
 * Remembers the last two zones focus was in, so Q goes back to the one before. The live
 * app's page keeps focus inside itself, so its element counts as the live zone.
 */
export function installZoneMemory(onEnter: (zone: GrowZone) => void): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const zone = zoneOf(event.target);
    if (zone !== null) onEnter(zone);
  };
  document.addEventListener("focusin", onFocusIn, true);
  return () => document.removeEventListener("focusin", onFocusIn, true);
}

/** Reloads the live app on screen: T3's own browser on the desktop, a frame on the web. */
export function reloadLive(): void {
  const page = zoneElement("live")?.querySelector(PAGE);
  if (page instanceof HTMLIFrameElement) {
    page.setAttribute("src", page.src);
    return;
  }
  if (
    page !== null &&
    page !== undefined &&
    "reload" in page &&
    typeof page.reload === "function"
  ) {
    page.reload();
  }
}
