/**
 * The drag handle on a pane's edge, so the owner can shrink and grow Grow's
 * panes. It reuses the app's `useResizeDrag` (the sidebar rail's pointer
 * lifecycle). While dragging only a CSS variable on the Grow container moves,
 * so the chat does not re-render per pixel; the width is committed to the store
 * on release. Double-click restores the default. The container is marked
 * `data-grow-resizing` meanwhile, which stops the prototype iframe from
 * swallowing the pointer.
 *
 * Put it inside the pane it resizes: `side="end"` on the pane left of the
 * chat (the rail), `side="start"` on panes right of it (the thing, or the chat
 * in Board mode). The chat itself always takes the remaining width.
 */
import { cn } from "../../lib/utils";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { GROW_BOARD_MIN, GROW_CHAT_MIN } from "./grow.logic";
import { GROW_PANE_SIZES, type GrowPane, useGrowStore } from "./grow.store";

export const growPaneVar = (pane: GrowPane) => `--grow-${pane}`;

export function GrowSplitter(props: { readonly pane: GrowPane; readonly side: "start" | "end" }) {
  const { pane, side } = props;
  const sizes = GROW_PANE_SIZES[pane];
  const resetWidth = useGrowStore((store) => store.resetWidth);
  const drag = useResizeDrag<HTMLDivElement>((event) => {
    const panel = event.currentTarget.parentElement;
    const container = event.currentTarget.closest<HTMLElement>("[data-grow-mode]");
    if (panel === null || container === null) return null;
    // The chat is what gives way, except in Board mode where the board does.
    const board = pane === "boardChat";
    const others = board
      ? 0
      : [...container.children]
          .filter((child) => child !== panel && !child.hasAttribute("data-grow-chat"))
          .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    const max = Math.max(
      sizes.min,
      Math.min(
        sizes.max,
        container.getBoundingClientRect().width - others - (board ? GROW_BOARD_MIN : GROW_CHAT_MIN),
      ),
    );
    const clamp = (value: number) => Math.min(max, Math.max(sizes.min, value));
    container.setAttribute("data-grow-resizing", "");
    return {
      width: panel.getBoundingClientRect().width,
      edge: side === "end" ? "right" : "left",
      resize(value) {
        const next = clamp(value);
        container.style.setProperty(growPaneVar(pane), `${next}px`);
        return next;
      },
      finish(width) {
        useGrowStore.getState().setWidth(pane, Math.round(width));
      },
      cleanup() {
        container.removeAttribute("data-grow-resizing");
      },
    };
  });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      className={cn(
        "group absolute inset-y-0 z-20 flex w-2 cursor-col-resize touch-none justify-center",
        side === "end" ? "-right-1" : "-left-1",
      )}
      onDoubleClick={() => resetWidth(pane)}
      {...drag}
    >
      <span className="w-px bg-transparent transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
    </div>
  );
}
