import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props {
  handlers: ResizableWidthHandlers;
  /** "horizontal" sits on the top edge of a panel stacked below the chat. */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

/** Resize hit target on a right panel's left edge, or a stacked panel's top edge. */
export function RightPanelResizeHandle({ handlers, orientation = "vertical", className }: Props) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "group absolute z-20 select-none",
        horizontal
          ? "inset-x-0 -top-1 h-2 cursor-row-resize"
          : "inset-y-0 -left-1 w-2 cursor-col-resize",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60",
          horizontal
            ? "inset-x-0 top-1/2 h-px -translate-y-1/2"
            : "inset-y-0 left-1/2 w-px -translate-x-1/2",
        )}
      />
    </div>
  );
}
