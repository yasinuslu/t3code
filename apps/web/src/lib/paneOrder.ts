export interface PaneBox {
  readonly left: number;
  readonly top: number;
}

/** Panes in screen order: left to right, and top to bottom where two share a left edge. */
export function paneOrder<T extends PaneBox>(panes: ReadonlyArray<T>): T[] {
  return panes.toSorted((a, b) => Math.round(a.left) - Math.round(b.left) || a.top - b.top);
}

/**
 * The pane one step left (-1) or right (1) of `current`, or null at the edge: movement
 * stops at the ends like tmux's, it does not wrap. With no current pane, right lands on
 * the first and left on the last.
 */
export function adjacentPane<T>(
  ordered: ReadonlyArray<T>,
  current: T | null,
  direction: -1 | 1,
): T | null {
  if (ordered.length === 0) return null;
  const index = current === null ? -1 : ordered.indexOf(current);
  if (index < 0) return (direction === 1 ? ordered[0] : ordered[ordered.length - 1]) ?? null;
  return ordered[index + direction] ?? null;
}
