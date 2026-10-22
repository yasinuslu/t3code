import { adjacentPane, paneOrder } from "./paneOrder";

/**
 * Keyboard movement between the panes on screen (sidebar, conversation, proof, side panel).
 * A pane is any element carrying `data-pane="<name>"`; the innermost visible ones count, in
 * screen order, so a layout needs no registry: it marks its columns and the keys find them.
 * `data-pane-row` marks the rows of a list pane that J and K step through, and
 * `data-pane-focus` the element a pane should land on first (the composer).
 */
const PANE = "[data-pane]";
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");
const CURRENT = '[aria-current]:not([aria-current="false"]), [role="tab"][aria-selected="true"]';
// Pages in these swallow every key, so a pane is never entered through one.
const FOREIGN = "iframe, webview";
const ROW = "[data-pane-row]";
const CURRENT_ATTR = '[aria-current]:not([aria-current="false"])';

/** Rendered and reachable by the keyboard, wherever it is scrolled to. */
function isRendered(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest("[inert]")) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && element.checkVisibility() !== false;
}

/**
 * A pane on screen and on top. A page that Grow or a sheet covers is still mounted and
 * rendered, so what is on top at the pane's centre says whether the keyboard can reach it.
 */
function isOnScreen(pane: HTMLElement): boolean {
  if (!isRendered(pane)) return false;
  const box = pane.getBoundingClientRect();
  if (box.right <= 0 || box.left >= window.innerWidth) return false;
  const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
  const top = document.elementFromPoint(x, y);
  return top !== null && pane.contains(top);
}

/** The visible panes that hold no other pane, in screen order. */
export function visiblePanes(): HTMLElement[] {
  const shown = [...document.querySelectorAll<HTMLElement>(PANE)].filter(isOnScreen);
  const leaves = shown.filter(
    (pane) => !shown.some((other) => other !== pane && pane.contains(other)),
  );
  return paneOrder(
    leaves.map((element) => {
      const box = element.getBoundingClientRect();
      return { element, left: box.left, top: box.top };
    }),
  ).map(({ element }) => element);
}

const lastFocus = new WeakMap<HTMLElement, HTMLElement>();
const lastRange = new WeakMap<HTMLElement, Range>();

function setActivePane(pane: HTMLElement | null) {
  for (const active of document.querySelectorAll("[data-pane-active]")) {
    if (active !== pane) active.removeAttribute("data-pane-active");
  }
  pane?.setAttribute("data-pane-active", "");
}

function ringOn() {
  return document.documentElement.hasAttribute("data-pane-ring");
}

/**
 * Remembers where focus was in each pane (the row, and the caret of an editor) so coming
 * back lands there, and follows the focus ring: shown after a pane key or Tab, hidden by
 * the mouse. Installed once.
 */
export function installPaneFocus(): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const pane = target.closest<HTMLElement>(PANE);
    if (!pane) return;
    if (target !== pane) lastFocus.set(pane, target);
    if (ringOn()) setActivePane(pane);
  };
  const onFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.isContentEditable) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && target.contains(selection.anchorNode)) {
      lastRange.set(target, selection.getRangeAt(0).cloneRange());
    }
  };
  const onPointerDown = () => {
    document.documentElement.removeAttribute("data-pane-ring");
    setActivePane(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || ringOn()) return;
    document.documentElement.setAttribute("data-pane-ring", "");
    const active = document.activeElement;
    if (active instanceof HTMLElement) setActivePane(active.closest(PANE));
  };
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}

function landingPoint(pane: HTMLElement): HTMLElement {
  const inside = (candidate: HTMLElement | null) =>
    candidate && isRendered(candidate) && !candidate.matches(FOREIGN) ? candidate : null;
  // A list pane lands on its current row (the open thread), not on a header clicked last.
  const current = inside(pane.querySelector<HTMLElement>(`${ROW}${CURRENT_ATTR}`));
  if (current) return current;
  const remembered = lastFocus.get(pane);
  if (remembered?.isConnected && pane.contains(remembered) && isRendered(remembered)) {
    return remembered;
  }
  return (
    inside(pane.querySelector<HTMLElement>("[data-pane-focus]")) ??
    [...pane.querySelectorAll<HTMLElement>(ROW)].find(isRendered) ??
    inside(pane.querySelector<HTMLElement>(CURRENT)) ??
    [...pane.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
      (candidate) => isRendered(candidate) && !candidate.closest(FOREIGN),
    ) ??
    pane
  );
}

/** Moves focus into a pane, at the place it was last, and shows the ring there. */
export function enterPane(pane: HTMLElement) {
  const target = landingPoint(pane);
  if (target === pane && !pane.hasAttribute("tabindex")) pane.setAttribute("tabindex", "-1");
  target.focus();
  const range = lastRange.get(target);
  if (range?.commonAncestorContainer.isConnected) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  document.documentElement.setAttribute("data-pane-ring", "");
  setActivePane(pane);
}

/** Focus one pane left (-1) or right (1) of the one holding focus. False at the edge. */
export function movePane(direction: -1 | 1): boolean {
  const panes = visiblePanes();
  const active = document.activeElement;
  const current = panes.find((pane) => active !== null && pane.contains(active)) ?? null;
  const next = adjacentPane(panes, current, direction);
  if (next === null) return false;
  enterPane(next);
  return true;
}

/** The first visible pane of that name, focused. False when none is on screen. */
export function focusPaneNamed(name: string): boolean {
  const pane = visiblePanes().find((candidate) => candidate.dataset.pane === name);
  if (!pane) return false;
  enterPane(pane);
  return true;
}

/** J / K (or the arrows) on a list pane's row: focus the row below (1) or above (-1). */
export function stepPaneRow(from: HTMLElement, direction: -1 | 1): boolean {
  const pane = from.closest<HTMLElement>(PANE);
  if (!pane || !from.matches(ROW)) return false;
  const rows = [...pane.querySelectorAll<HTMLElement>(ROW)].filter(isRendered);
  const next = rows[rows.indexOf(from) + direction];
  if (!next) return true;
  next.focus();
  return true;
}
