import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { FileSurfaceNotice } from "./fileSurfaceChrome";
import {
  cellHasFormula,
  cellText,
  columnLabel,
  deleteRow,
  insertRow,
  type SheetData,
  type SpreadsheetDocument,
  setCellText,
} from "./spreadsheetDocument";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 24;
const GUTTER_WIDTH = 44;
const ROW_OVERSCAN = 8;
const COLUMN_OVERSCAN_PX = 240;
/** Horizontal scroll is bucketed, so a pixel of drag does not repaint the grid. */
const SCROLL_LEFT_BUCKET = 64;

interface Cell {
  readonly row: number;
  readonly column: number;
}

/** First index whose offset is greater than `target`, minus one. */
function indexAtOffset(offsets: ReadonlyArray<number>, target: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((offsets[middle] ?? 0) <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * A windowed grid: only the rows and columns in view are in the DOM, so a sheet of a hundred
 * thousand rows scrolls like a short one. The first row stays under the column letters.
 */
function SpreadsheetGrid(props: {
  readonly name: string;
  readonly sheet: SheetData;
  readonly editable: boolean;
  readonly selected: Cell | null;
  readonly editing: string | null;
  readonly onSelect: (cell: Cell) => void;
  readonly onEdit: (value: string) => void;
  readonly onCommit: (value: string, move: "down" | "right" | "stay") => void;
  readonly onCancelEdit: () => void;
  readonly onClear: () => void;
}) {
  const { sheet, selected, editing } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState({ width: 640, height: 480 });

  const offsets = useMemo(() => {
    const result = [0];
    for (const width of sheet.widths) result.push((result.at(-1) ?? 0) + width);
    return result;
  }, [sheet.widths]);
  const totalWidth = GUTTER_WIDTH + (offsets.at(-1) ?? 0);
  const rowCount = sheet.rows.length;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const firstRow = Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
  const lastRow = Math.min(
    rowCount - 1,
    Math.ceil((scrollTop + viewport.height) / ROW_HEIGHT) + ROW_OVERSCAN,
  );
  const firstColumn = indexAtOffset(offsets, Math.max(0, scrollLeft - COLUMN_OVERSCAN_PX));
  const lastColumn = Math.min(
    sheet.columns - 1,
    indexAtOffset(offsets, scrollLeft + viewport.width + COLUMN_OVERSCAN_PX),
  );

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(Math.floor(element.scrollTop / ROW_HEIGHT) * ROW_HEIGHT);
    setScrollLeft(Math.floor(element.scrollLeft / SCROLL_LEFT_BUCKET) * SCROLL_LEFT_BUCKET);
  };

  const reveal = useCallback(
    (cell: Cell) => {
      const element = scrollRef.current;
      if (!element) return;
      const top = HEADER_HEIGHT + cell.row * ROW_HEIGHT;
      const stickyBottom = element.scrollTop + HEADER_HEIGHT + ROW_HEIGHT;
      if (cell.row > 0 && top < stickyBottom) element.scrollTop = top - HEADER_HEIGHT - ROW_HEIGHT;
      else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
      }
      const left = GUTTER_WIDTH + (offsets[cell.column] ?? 0);
      const right = GUTTER_WIDTH + (offsets[cell.column + 1] ?? 0);
      if (left - GUTTER_WIDTH < element.scrollLeft) element.scrollLeft = left - GUTTER_WIDTH;
      else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right - element.clientWidth;
      }
    },
    [offsets],
  );

  // Keep the selection in view when it moves (keyboard, add row), not when it is clicked.
  const selectedRow = selected?.row;
  const selectedColumn = selected?.column;
  useEffect(() => {
    if (selectedRow !== undefined && selectedColumn !== undefined) {
      reveal({ row: selectedRow, column: selectedColumn });
    }
  }, [reveal, selectedRow, selectedColumn]);

  const move = (row: number, column: number) => {
    const next = {
      row: Math.min(Math.max(row, 0), Math.max(rowCount - 1, 0)),
      column: Math.min(Math.max(column, 0), Math.max(sheet.columns - 1, 0)),
    };
    props.onSelect(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing !== null) return;
    if (!selected || event.metaKey || event.ctrlKey || event.altKey) return;
    const { row, column } = selected;
    const step: Record<string, readonly [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-10, 0],
      PageDown: [10, 0],
    };
    const delta = event.key === "Tab" ? ([0, event.shiftKey ? -1 : 1] as const) : step[event.key];
    if (delta) {
      event.preventDefault();
      move(row + delta[0], column + delta[1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(row, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(row, sheet.columns - 1);
    } else if (!props.editable) {
      return;
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      props.onEdit(cellText(sheet.rows[row]?.[column]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      props.onClear();
    } else if (event.key.length === 1) {
      event.preventDefault();
      props.onEdit(event.key);
    }
  };

  const cellAt = (event: MouseEvent): Cell | null => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!element) return null;
    return { row: Number(element.dataset.row), column: Number(element.dataset.column) };
  };

  const renderRow = (row: number, sticky: boolean) => {
    const cells = sheet.rows[row];
    const isHeader = row === 0;
    const items = [];
    for (let column = firstColumn; column <= lastColumn; column++) {
      const cell = cells?.[column];
      const isSelected = selected?.row === row && selected.column === column;
      const isEditing = isSelected && editing !== null;
      items.push(
        <div
          key={column}
          role="gridcell"
          aria-selected={isSelected}
          data-cell=""
          data-row={row}
          data-column={column}
          className={cn(
            "relative shrink-0 truncate border-b border-r border-border/50 px-2 leading-6.75 select-none",
            cell?.t === "n" && "text-right tabular-nums",
            isHeader && "bg-muted/70 font-medium",
            isSelected && "z-10 outline-2 -outline-offset-2 outline-primary",
          )}
          style={{ width: sheet.widths[column] }}
        >
          {isEditing ? (
            <CellEditor initial={editing} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
          ) : (
            cellText(cell)
          )}
        </div>,
      );
    }
    return (
      <div
        key={row}
        role="row"
        aria-rowindex={row + 1}
        className={cn("flex", sticky ? "sticky z-20 bg-background" : "absolute left-0")}
        style={{
          height: ROW_HEIGHT,
          width: totalWidth,
          ...(sticky ? { top: HEADER_HEIGHT } : { top: HEADER_HEIGHT + row * ROW_HEIGHT }),
        }}
      >
        <div
          className="sticky left-0 z-10 shrink-0 border-b border-r border-border/60 bg-muted text-center leading-6.75 text-muted-foreground select-none"
          style={{ width: GUTTER_WIDTH }}
        >
          {row + 1}
        </div>
        <div className="shrink-0" style={{ width: offsets[firstColumn] }} />
        {items}
      </div>
    );
  };

  const bodyRows = [];
  for (let row = firstRow; row <= lastRow; row++) bodyRows.push(renderRow(row, false));

  const headerLabels = [];
  for (let column = firstColumn; column <= lastColumn; column++) {
    headerLabels.push(
      <div
        key={column}
        className={cn(
          "shrink-0 border-b border-r border-border/60 bg-muted text-center leading-5.75 text-muted-foreground select-none",
          selected?.column === column && "bg-accent text-foreground",
        )}
        style={{ width: sheet.widths[column] }}
      >
        {columnLabel(column)}
      </div>,
    );
  }

  return (
    // The grid is one tab stop and moves its own selection, like a native grid.
    <div
      ref={scrollRef}
      role="grid"
      tabIndex={0}
      aria-label={props.name}
      aria-rowcount={rowCount}
      aria-colcount={sheet.columns}
      className="relative min-h-0 flex-1 overflow-auto text-xs outline-none"
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        const cell = cellAt(event);
        if (!cell) return;
        if (editing !== null) {
          // A click inside the field places the caret. Anywhere else commits the edit first.
          if (selected?.row === cell.row && selected.column === cell.column) return;
          (document.activeElement as HTMLElement | null)?.blur();
        }
        props.onSelect(cell);
      }}
      onDoubleClick={(event) => {
        const cell = cellAt(event);
        if (cell && props.editable) props.onEdit(cellText(sheet.rows[cell.row]?.[cell.column]));
      }}
    >
      <div
        className="relative"
        style={{ width: totalWidth, height: HEADER_HEIGHT + rowCount * ROW_HEIGHT }}
      >
        <div
          className="sticky top-0 z-30 flex"
          style={{ height: HEADER_HEIGHT, width: totalWidth }}
        >
          <div
            className="sticky left-0 z-10 shrink-0 border-b border-r border-border/60 bg-muted"
            style={{ width: GUTTER_WIDTH }}
          />
          <div className="shrink-0" style={{ width: offsets[firstColumn] }} />
          {headerLabels}
        </div>
        {rowCount > 0 ? renderRow(0, true) : null}
        {bodyRows}
      </div>
      {rowCount === 0 ? (
        <p className="absolute inset-x-0 top-16 text-center text-muted-foreground">
          This sheet is empty.
        </p>
      ) : null}
    </div>
  );
}

/** One cell's text field. Enter and Tab commit, Escape discards, leaving the cell commits. */
function CellEditor(props: {
  readonly initial: string;
  readonly onCommit: (value: string, move: "down" | "right" | "stay") => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const finished = useRef(false);
  const finish = (move: "down" | "right" | "stay") => {
    if (finished.current) return;
    finished.current = true;
    props.onCommit(value, move);
  };
  return (
    <textarea
      autoFocus
      rows={1}
      aria-label="Cell value"
      value={value}
      spellCheck={false}
      className="absolute inset-0 z-20 resize-none overflow-hidden bg-background px-2 leading-6.75 outline-2 -outline-offset-2 outline-primary"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
      onBlur={() => finish("stay")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          finished.current = true;
          props.onCancel();
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish("down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          finish("right");
        }
      }}
    />
  );
}

/**
 * Sheet tabs, a cell readout, and the grid. The document is a value owned by the caller:
 * every edit hands back the next document through `onChange`, and without `onChange` the
 * grid is read-only.
 */
export function SpreadsheetEditor(props: {
  readonly name: string;
  readonly doc: SpreadsheetDocument;
  readonly onChange?: (doc: SpreadsheetDocument) => void;
  /** Explicit save (workbooks); CSV saves itself from `onChange`. */
  readonly onSave?: () => void;
  readonly dirty?: boolean;
  readonly saving?: boolean;
  readonly notice?: string | null;
  readonly onDismissNotice?: () => void;
}) {
  const { doc, onChange } = props;
  const editable = onChange !== undefined;
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const activeIndex = Math.min(sheetIndex, doc.sheets.length - 1);
  const sheet = doc.sheets[activeIndex];
  const gridRef = useRef<HTMLDivElement>(null);

  const refocusGrid = () => {
    // The edit field unmounts first; hand focus back so arrows keep moving.
    queueMicrotask(() => gridRef.current?.querySelector<HTMLElement>("[role=grid]")?.focus());
  };

  if (!sheet) return null;
  const cell = selected ? sheet.rows[selected.row]?.[selected.column] : undefined;
  const readout = selected ? (cellHasFormula(cell) ? `=${cell?.f}` : cellText(cell)) : "";

  // Formula results are the file's cached values; nothing here recalculates them.
  const noteFormulas = () => {
    if (sheet.hasFormulas) {
      setRowNotice(
        "Formulas are not recalculated here: results update when the file is opened in a spreadsheet app, and row changes do not adjust references.",
      );
    }
  };

  const commit = (value: string, move: "down" | "right" | "stay") => {
    if (!selected || !onChange) return;
    if (value !== cellText(cell)) noteFormulas();
    onChange(setCellText(doc, activeIndex, selected.row, selected.column, value));
    setEditing(null);
    if (move === "down") {
      setSelected({ row: selected.row + 1, column: selected.column });
    } else if (move === "right") {
      setSelected({
        row: selected.row,
        column: Math.min(selected.column + 1, Math.max(sheet.columns - 1, 0)),
      });
    }
    refocusGrid();
  };

  const structural = (next: SpreadsheetDocument, select: Cell | null) => {
    onChange?.(next);
    setSelected(select);
    noteFormulas();
  };

  const addRow = () => {
    const at = selected ? selected.row + 1 : sheet.rows.length;
    structural(insertRow(doc, activeIndex, at), { row: at, column: selected?.column ?? 0 });
  };

  const removeRow = () => {
    if (!selected) return;
    const next = deleteRow(doc, activeIndex, selected.row);
    structural(next, {
      row: Math.min(selected.row, Math.max(next.sheets[activeIndex]!.rows.length - 1, 0)),
      column: selected.column,
    });
  };

  const notice = rowNotice ?? props.notice;
  const dismissNotice = rowNotice ? () => setRowNotice(null) : props.onDismissNotice;

  return (
    <div ref={gridRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
        <span className="w-9 shrink-0 font-mono text-muted-foreground">
          {selected ? `${columnLabel(selected.column)}${selected.row + 1}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate">{readout}</span>
        {editable ? (
          <>
            <Button variant="ghost" size="compact" onClick={addRow}>
              <PlusIcon />
              Row
            </Button>
            <Button variant="ghost" size="compact" disabled={!selected} onClick={removeRow}>
              <Trash2Icon />
              Row
            </Button>
          </>
        ) : null}
        {props.onSave ? (
          <>
            {props.dirty ? (
              <span className="size-2 shrink-0 rounded-full bg-primary" role="status">
                <span className="sr-only">Unsaved changes</span>
              </span>
            ) : null}
            <Button size="compact" disabled={!props.dirty || props.saving} onClick={props.onSave}>
              <SaveIcon />
              {props.saving ? "Saving…" : "Save"}
            </Button>
          </>
        ) : null}
      </div>
      {notice ? (
        <FileSurfaceNotice>
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">{notice}</span>
            {dismissNotice ? (
              <button type="button" className="shrink-0 underline" onClick={dismissNotice}>
                Dismiss
              </button>
            ) : null}
          </div>
        </FileSurfaceNotice>
      ) : null}
      <SpreadsheetGrid
        key={activeIndex}
        name={props.name}
        sheet={sheet}
        editable={editable}
        selected={selected}
        editing={editing}
        onSelect={(next) => {
          setSelected(next);
          setEditing(null);
        }}
        onEdit={(value) => setEditing(value)}
        onCommit={commit}
        onCancelEdit={() => {
          setEditing(null);
          refocusGrid();
        }}
        onClear={() => {
          if (selected && onChange) {
            onChange(setCellText(doc, activeIndex, selected.row, selected.column, ""));
          }
        }}
      />
      {doc.sheets.length > 1 || doc.kind === "xlsx" ? (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-border/60 px-2 text-xs"
        >
          {doc.sheets.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 focus-visible:ring-2 focus-visible:ring-ring",
                index === activeIndex
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              onClick={() => {
                setSheetIndex(index);
                setSelected(null);
                setEditing(null);
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
