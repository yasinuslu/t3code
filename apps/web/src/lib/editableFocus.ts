const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

/** Inline components (Lit custom elements in assistant replies) are named `t3-*`. */
const INLINE_COMPONENT_PREFIX = "t3-";

/**
 * Whether a text-editing element owns the keyboard. Shortcuts that share
 * their chord with native editing (mod+z) must yield when this is true.
 * Looks through open shadow roots: `document.activeElement` stops at the host.
 */
export function isEditableFocused(target: EventTarget | null = document.activeElement): boolean {
  let element: Element | null = target instanceof Element ? target : null;
  while (element) {
    if (element.closest(EDITABLE_SELECTOR) !== null) return true;
    element = element.shadowRoot?.activeElement ?? null;
  }
  return false;
}

/**
 * Whether a key event comes from an inline component (a `t3-*` element or anything inside its
 * shadow root) or from an editable control inside any shadow root. The event target is
 * retargeted to the shadow host, so only `composedPath()` shows what was really focused.
 * Bare-key shortcut handlers must ignore such events.
 */
export function isInlineComponentEvent(
  event: Pick<Event, "target"> & { composedPath?: () => EventTarget[] },
): boolean {
  const path = event.composedPath?.() ?? (event.target ? [event.target] : []);
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.localName.startsWith(INLINE_COMPONENT_PREFIX)) return true;
    if (node.getRootNode() instanceof ShadowRoot && node.matches(EDITABLE_SELECTOR)) return true;
  }
  return false;
}
