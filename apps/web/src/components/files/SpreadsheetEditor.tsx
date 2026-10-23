import {
  ArrowDownIcon,
  ArrowUpIcon,
  PanelLeftIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { FileSurfaceNotice } from "./fileSurfaceChrome";
import { SpreadsheetColumnMenu } from "./SpreadsheetColumnMenu";
import {
  canReorderRows,
  cellHasFormula,
  cellText,
  columnLabel,
  deleteRow,
  insertRow,
  reorderRows,
  type SheetData,
  type SpreadsheetDocument,
  setCellText,
} from "./spreadsheetDocument";
import {
  activeFilterCount,
  type CellRef,
  type ColumnFilter,
  computeView,
  EMPTY_VIEW,
  rangeToTsv,
  type SheetView,
  type SortState,
  selectionSpan,
  sortedBodyOrder,
  summarize,
  type ViewRows,
} from "./spreadsheetView";

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 24;
const GUTTER_WIDTH = 44;
const ROW_OVERSCAN = 8;
const COLUMN_OVERSCAN_PX = 240;
const MIN_RESIZED_COLUMN_PX = 40;
const MAX_RESIZED_COLUMN_PX = 800;
/** Horizontal scroll is bucketed, so a pixel of drag does not repaint the grid. */
const SCROLL_LEFT_BUCKET = 64;

type Cell = CellRef;

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
 * thousand rows scrolls like a short one. The first row stays under the column letters. Rows
 * are drawn in the order `view` gives, but a cell is always named by its source row, so the
 * selection, an edit and a copy mean the same cell whatever the sort or filter.
 */
function SpreadsheetGrid(props: {
  readonly name: string;
  readonly sheet: SheetData;
  readonly view: ViewRows;
  /** Column widths in px with the user's drags applied. */
  readonly widths: ReadonlyArray<number>;
  readonly frozenColumn: boolean;
  readonly editable: boolean;
  readonly selected: Cell | null;
  readonly anchor: Cell | null;
  readonly editing: string | null;
  /** What the header buttons show and change; the file is not touched. */
  readonly sheetView: SheetView;
  readonly onSort: (column: number, direction: "asc" | "desc" | null) => void;
  readonly onFilter: (column: number, filter: ColumnFilter | undefined) => void;
  /** `extend` grows the block from its anchor instead of starting a new one. */
  readonly onSelect: (cell: Cell, extend: boolean) => void;
  readonly onResize: (column: number, width: number | null) => void;
  readonly onEdit: (value: string) => void;
  readonly onCommit: (value: string, move: "down" | "right" | "stay") => void;
  readonly onCancelEdit: () => void;
  readonly onClear: () => void;
}) {
  const { sheet, view, selected, editing, widths } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState({ width: 640, height: 480 });
  const dragging = useRef(false);
  const resizing = useRef<{ column: number; startX: number; startWidth: number } | null>(null);

  const offsets = useMemo(() => {
    const result = [0];
    for (const width of widths) result.push((result.at(-1) ?? 0) + width);
    return result;
  }, [widths]);
  const totalWidth = GUTTER_WIDTH + (offsets.at(-1) ?? 0);
  const rowCount = view.rows.length;
  const frozen = props.frozenColumn && sheet.columns > 1;
  const frozenWidth = frozen ? (widths[0] ?? 0) : 0;
  const span = selectionSpan(view, selected, props.anchor);
  const isBlock =
    span !== null &&
    (span.firstPosition !== span.lastPosition || span.firstColumn !== span.lastColumn);
  const selectedPosition = selected ? (view.positions[selected.row] ?? -1) : -1;

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
  // With the first column frozen it is drawn on its own, so the scrolling run starts after it.
  const runStart = frozen ? Math.max(firstColumn, 1) : firstColumn;

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollTop(Math.floor(element.scrollTop / ROW_HEIGHT) * ROW_HEIGHT);
    setScrollLeft(Math.floor(element.scrollLeft / SCROLL_LEFT_BUCKET) * SCROLL_LEFT_BUCKET);
  };

  const reveal = useCallback(
    (position: number, column: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const top = HEADER_HEIGHT + position * ROW_HEIGHT;
      const stickyBottom = element.scrollTop + HEADER_HEIGHT + ROW_HEIGHT;
      if (position > 0 && top < stickyBottom) {
        element.scrollTop = top - HEADER_HEIGHT - ROW_HEIGHT;
      } else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
      }
      if (frozen && column === 0) return;
      const left = offsets[column] ?? 0;
      const right = offsets[column + 1] ?? 0;
      if (left < element.scrollLeft + frozenWidth) element.scrollLeft = left - frozenWidth;
      else if (right + GUTTER_WIDTH > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right + GUTTER_WIDTH - element.clientWidth;
      }
    },
    [offsets, frozen, frozenWidth],
  );

  // Keep the selection in view when it moves (keyboard, add row, a new sort), not when it is
  // clicked or a column is resized. The latest `reveal` is read through a ref so a resize,
  // which rebuilds it, does not scroll.
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  });
  const selectedColumn = selected?.column;
  useEffect(() => {
    if (selectedPosition >= 0 && selectedColumn !== undefined) {
      revealRef.current(selectedPosition, selectedColumn);
    }
  }, [selectedPosition, selectedColumn]);

  const move = (rows: number, columns: number, extend: boolean) => {
    const from = Math.max(selectedPosition, 0);
    const position = Math.min(Math.max(from + rows, 0), Math.max(rowCount - 1, 0));
    props.onSelect(
      {
        row: view.rows[position] ?? 0,
        column: Math.min(
          Math.max((selected?.column ?? 0) + columns, 0),
          Math.max(sheet.columns - 1, 0),
        ),
      },
      extend,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys from the header buttons and the filter panel are theirs, not cell input.
    if (event.target !== event.currentTarget) return;
    if (editing !== null) return;
    if (!selected || event.metaKey || event.ctrlKey || event.altKey) return;
    const step: Record<string, readonly [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-10, 0],
      PageDown: [10, 0],
    };
    if (event.key === "Tab") {
      event.preventDefault();
      move(0, event.shiftKey ? -1 : 1, false);
      return;
    }
    const delta = step[event.key];
    if (delta) {
      event.preventDefault();
      move(delta[0], delta[1], event.shiftKey);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0, -sheet.columns, event.shiftKey);
    } else if (event.key === "End") {
      event.preventDefault();
      move(0, sheet.columns, event.shiftKey);
    } else if (!props.editable) {
      return;
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      props.onEdit(cellText(sheet.rows[selected.row]?.[selected.column]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (!isBlock) props.onClear();
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

  const onCopy = (event: ClipboardEvent) => {
    if (editing !== null || !span) return;
    const rows = view.rows.slice(span.firstPosition, span.lastPosition + 1);
    event.clipboardData.setData(
      "text/plain",
      rangeToTsv(sheet, rows, span.firstColumn, span.lastColumn),
    );
    event.preventDefault();
  };

  const startResize = (event: PointerEvent<HTMLDivElement>, column: number) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = { column, startX: event.clientX, startWidth: widths[column] ?? 96 };
  };

  const dragResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizing.current;
    if (!drag) return;
    const width = drag.startWidth + event.clientX - drag.startX;
    props.onResize(
      drag.column,
      Math.min(MAX_RESIZED_COLUMN_PX, Math.max(MIN_RESIZED_COLUMN_PX, Math.round(width))),
    );
  };

  const inBlock = (position: number, column: number) =>
    isBlock &&
    position >= span.firstPosition &&
    position <= span.lastPosition &&
    column >= span.firstColumn &&
    column <= span.lastColumn;

  const renderCell = (row: number, position: number, column: number, frozenCell: boolean) => {
    const cell = sheet.rows[row]?.[column];
    const isHeader = position === 0;
    const isSelected = selected?.row === row && selected.column === column;
    const isEditing = isSelected && editing !== null;
    return (
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
          isHeader && "bg-muted/70 pr-11 font-medium",
          frozenCell && "sticky z-20 border-r-border bg-background",
          frozenCell && isHeader && "bg-muted",
          !isHeader && inBlock(position, column) && "bg-primary/10",
          isSelected && "z-10 outline-2 -outline-offset-2 outline-primary",
        )}
        style={{
          width: widths[column],
          ...(frozenCell ? { left: GUTTER_WIDTH } : {}),
        }}
      >
        {isEditing ? (
          <CellEditor initial={editing} onCommit={props.onCommit} onCancel={props.onCancelEdit} />
        ) : (
          cellText(cell)
        )}
        {isHeader && !isEditing ? (
          <div className="absolute inset-y-0 right-0.5 flex items-center gap-0.5">
            <SpreadsheetColumnMenu
              sheet={sheet}
              view={props.sheetView}
              column={column}
              label={cellText(cell).trim()}
              onSort={props.onSort}
              onFilter={props.onFilter}
            />
          </div>
        ) : null}
      </div>
    );
  };

  const renderRow = (position: number, sticky: boolean) => {
    const row = view.rows[position] ?? 0;
    const items = [];
    for (let column = runStart; column <= lastColumn; column++) {
      items.push(renderCell(row, position, column, false));
    }
    return (
      <div
        key={row}
        role="row"
        aria-rowindex={position + 1}
        className={cn("flex", sticky ? "sticky z-20 bg-background" : "absolute left-0 z-0")}
        style={{
          height: ROW_HEIGHT,
          width: totalWidth,
          top: sticky ? HEADER_HEIGHT : HEADER_HEIGHT + position * ROW_HEIGHT,
        }}
      >
        {/* The number is the cell's address in the file, so it stays put through a sort. */}
        {/* The theme's muted fill is translucent, so an opaque layer keeps cells from showing through. */}
        <div className="sticky left-0 z-20 shrink-0 bg-background" style={{ width: GUTTER_WIDTH }}>
          <div className="size-full border-b border-r border-border/60 bg-muted text-center leading-6.75 text-muted-foreground select-none">
            {row + 1}
          </div>
        </div>
        {frozen ? renderCell(row, position, 0, true) : null}
        <div
          className="shrink-0"
          style={{ width: (offsets[runStart] ?? 0) - (frozen ? (offsets[1] ?? 0) : 0) }}
        />
        {items}
      </div>
    );
  };

  const bodyRows = [];
  for (let position = firstRow; position <= lastRow; position++) {
    bodyRows.push(renderRow(position, false));
  }

  const renderLetter = (column: number, frozenCell: boolean) => (
    <div
      key={column}
      className={cn(
        "relative shrink-0 border-b border-r border-border/60 bg-muted text-center leading-5.75 text-muted-foreground select-none",
        frozenCell && "sticky z-20 border-r-border",
        selected?.column === column && "bg-accent text-foreground",
      )}
      style={{ width: widths[column], ...(frozenCell ? { left: GUTTER_WIDTH } : {}) }}
    >
      {columnLabel(column)}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize column ${columnLabel(column)}`}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-primary/40"
        onPointerDown={(event) => startResize(event, column)}
        onPointerMove={dragResize}
        onPointerUp={() => {
          resizing.current = null;
        }}
        onPointerCancel={() => {
          resizing.current = null;
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          props.onResize(column, null);
        }}
      />
    </div>
  );

  const letters = [];
  for (let column = runStart; column <= lastColumn; column++) {
    letters.push(renderLetter(column, false));
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
      onCopy={onCopy}
      onMouseDown={(event) => {
        const cell = cellAt(event);
        if (!cell) return;
        if (editing !== null) {
          // A click inside the field places the caret. Anywhere else commits the edit first.
          if (selected?.row === cell.row && selected.column === cell.column) return;
          (document.activeElement as HTMLElement | null)?.blur();
        }
        dragging.current = event.button === 0 && !event.shiftKey;
        props.onSelect(cell, event.shiftKey);
      }}
      onMouseMove={(event) => {
        if (!dragging.current) return;
        if ((event.buttons & 1) === 0) {
          dragging.current = false;
          return;
        }
        const cell = cellAt(event);
        if (cell && (cell.row !== selected?.row || cell.column !== selected.column)) {
          props.onSelect(cell, true);
        }
      }}
      onMouseUp={() => {
        dragging.current = false;
      }}
      onMouseLeave={() => {
        dragging.current = false;
      }}
      onDoubleClick={(event) => {
        const cell = cellAt(event);
        if (cell && props.editable) {
          props.onEdit(cellText(sheet.rows[cell.row]?.[cell.column]));
        }
      }}
    >
      <div
        className="relative"
        style={{ width: totalWidth, height: HEADER_HEIGHT + rowCount * ROW_HEIGHT }}
      >
        <div
          className="sticky top-0 z-30 flex bg-background"
          style={{ height: HEADER_HEIGHT, width: totalWidth }}
        >
          <div
            className="sticky left-0 z-20 shrink-0 border-b border-r border-border/60 bg-muted"
            style={{ width: GUTTER_WIDTH }}
          />
          {frozen ? renderLetter(0, true) : null}
          <div
            className="shrink-0"
            style={{ width: (offsets[runStart] ?? 0) - (frozen ? (offsets[1] ?? 0) : 0) }}
          />
          {letters}
        </div>
        {rowCount > 0 ? renderRow(0, true) : null}
        {bodyRows}
      </div>
      {rowCount === 0 ? (
        <p className="absolute inset-x-0 top-16 text-center text-muted-foreground">
          This sheet is empty.
        </p>
      ) : rowCount === 1 && view.total > 0 ? (
        <p className="absolute inset-x-0 top-24 text-center text-muted-foreground">
          No rows match the filters.
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

/** What the user has set up on one sheet. None of it touches the file. */
interface SheetUi {
  readonly view: SheetView;
  readonly frozenColumn: boolean;
  /** Column widths dragged by hand, by column. */
  readonly widths: Readonly<Record<number, number>>;
}

const EMPTY_UI: SheetUi = { view: EMPTY_VIEW, frozenColumn: false, widths: {} };
const EMPTY_SHEET: SheetData = {
  name: "",
  rows: [],
  columns: 0,
  widths: [],
  merges: [],
  rowHeights: [],
  hasFormulas: false,
  layout: 0,
  dirty: false,
  source: null,
};

/**
 * The rows to draw. Sorting and filtering are applied when the view is set up and when rows
 * are added, removed or reordered, not on every edit: a row whose cell you just changed keeps
 * its place until you sort or filter again, like a spreadsheet app.
 */
function useViewRows(
  sheet: SheetData,
  scope: object,
  sort: SortState | null,
  filters: SheetView["filters"],
  search: string,
): ViewRows {
  const key = { scope, sort, filters, search, layout: sheet.layout, rowCount: sheet.rows.length };
  const [cached, setCached] = useState(() => ({
    key,
    view: computeView(sheet, { sort, filters, search }),
  }));
  const same = Object.keys(key).every(
    (name) => key[name as keyof typeof key] === cached.key[name as keyof typeof key],
  );
  if (same) return cached.view;
  const view = computeView(sheet, { sort, filters, search });
  setCached({ key, view });
  return view;
}

const countFormat = new Intl.NumberFormat();
const sumFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const plural = (count: number, noun: string) =>
  `${countFormat.format(count)} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Sheet tabs, a cell readout, and the grid. The document is a value owned by the caller:
 * every edit hands back the next document through `onChange`, and without `onChange` the
 * grid is read-only. Sorting, filtering, searching, a frozen column and column widths are a
 * view kept here; only "Apply sort to file" writes a new row order into the document.
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
  // The focused cell and, while a block is selected, the corner it grows from.
  const [{ focus: selected, anchor }, setSelection] = useState<{
    focus: Cell | null;
    anchor: Cell | null;
  }>({ focus: null, anchor: null });
  const setSelected = (cell: Cell | null) => setSelection({ focus: cell, anchor: null });
  const [editing, setEditing] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [uiBySheet, setUiBySheet] = useState<Readonly<Record<number, SheetUi>>>({});
  const activeIndex = Math.min(sheetIndex, doc.sheets.length - 1);
  const sheet = doc.sheets[activeIndex] ?? EMPTY_SHEET;
  const ui = uiBySheet[activeIndex] ?? EMPTY_UI;
  const gridRef = useRef<HTMLDivElement>(null);

  const updateUi = (update: (current: SheetUi) => SheetUi) =>
    setUiBySheet((all) => ({ ...all, [activeIndex]: update(all[activeIndex] ?? EMPTY_UI) }));
  // A block selected before the rows moved would stretch across unrelated rows, so it collapses.
  const updateView = (update: (current: SheetView) => SheetView) => {
    updateUi((current) => ({ ...current, view: update(current.view) }));
    setSelection((current) => ({ ...current, anchor: null }));
  };

  // Typing in the search box stays instant; the rows catch up when the browser is idle.
  const search = useDeferredValue(ui.view.search);
  const scope = doc.workbook ?? doc.csv ?? doc;
  const viewRows = useViewRows(sheet, scope, ui.view.sort, ui.view.filters, search);

  const widths = useMemo(
    () => sheet.widths.map((width, column) => ui.widths[column] ?? width),
    [sheet.widths, ui.widths],
  );

  const span = selectionSpan(viewRows, selected, anchor);
  const isBlock =
    span !== null &&
    (span.firstPosition !== span.lastPosition || span.firstColumn !== span.lastColumn);
  // One cell summarizes its whole column; a block summarizes itself.
  const summaryFrom = span ? (isBlock ? span.firstPosition : 1) : -1;
  const summaryTo = span ? (isBlock ? span.lastPosition : viewRows.rows.length - 1) : -1;
  const summaryFirstColumn = span?.firstColumn ?? 0;
  const summaryLastColumn = span?.lastColumn ?? 0;
  const summary = useMemo(
    () =>
      summaryFrom < 0
        ? null
        : summarize(
            sheet,
            viewRows.rows.slice(summaryFrom, summaryTo + 1),
            summaryFirstColumn,
            summaryLastColumn,
          ),
    [sheet, viewRows, summaryFrom, summaryTo, summaryFirstColumn, summaryLastColumn],
  );

  const refocusGrid = () => {
    // The edit field unmounts first; hand focus back so arrows keep moving.
    queueMicrotask(() => gridRef.current?.querySelector<HTMLElement>("[role=grid]")?.focus());
  };

  if (doc.sheets.length === 0) return null;
  const cell = selected ? sheet.rows[selected.row]?.[selected.column] : undefined;
  const readout = selected ? (cellHasFormula(cell) ? `=${cell?.f}` : cellText(cell)) : "";

  const select = (next: Cell, extend: boolean) => {
    setSelection((previous) => ({
      focus: next,
      anchor: extend ? (previous.anchor ?? previous.focus ?? next) : null,
    }));
    setEditing(null);
  };

  // Formula results are the file's cached values; nothing here recalculates them.
  const noteFormulas = () => {
    if (sheet.hasFormulas) {
      setRowNotice(
        "Formulas are not recalculated here: results update when the file is opened in a spreadsheet app, and row changes do not adjust references.",
      );
    }
  };

  const nextRowDown = (row: number) => {
    const position = viewRows.positions[row] ?? -1;
    if (position < 0) return row;
    return viewRows.rows[Math.min(position + 1, viewRows.rows.length - 1)] ?? row;
  };

  const commit = (value: string, move: "down" | "right" | "stay") => {
    if (!selected || !onChange) return;
    if (value !== cellText(cell)) noteFormulas();
    onChange(setCellText(doc, activeIndex, selected.row, selected.column, value));
    setEditing(null);
    if (move === "down") {
      setSelected({ row: nextRowDown(selected.row), column: selected.column });
    } else if (move === "right") {
      setSelected({
        row: selected.row,
        column: Math.min(selected.column + 1, Math.max(sheet.columns - 1, 0)),
      });
    }
    refocusGrid();
  };

  const structural = (next: SpreadsheetDocument, target: Cell | null) => {
    onChange?.(next);
    setSelected(target);
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

  const setSort = (column: number, direction: "asc" | "desc" | null) =>
    updateView((view) => ({ ...view, sort: direction ? { column, direction } : null }));

  const setFilter = (column: number, filter: ColumnFilter | undefined) =>
    updateView((view) => {
      const { [column]: _removed, ...rest } = view.filters;
      return { ...view, filters: filter ? { ...rest, [column]: filter } : rest };
    });

  const sort = ui.view.sort;
  const filteredBy = activeFilterCount(ui.view) > 0 || search.trim() !== "";
  const headerName = (column: number) => cellText(sheet.rows[0]?.[column]).trim();
  const canApplySort = editable && sort !== null && sheet.rows.length > 2 && canReorderRows(sheet);

  const applySort = () => {
    if (!sort || !onChange) return;
    const next = reorderRows(doc, activeIndex, sortedBodyOrder(sheet, sort));
    if (next !== doc) {
      onChange(next);
      setSelected(null);
      noteFormulas();
    }
    setSort(sort.column, null);
  };

  const notice = rowNotice ?? props.notice;
  const dismissNotice = rowNotice ? () => setRowNotice(null) : props.onDismissNotice;

  const summaryLabel = summary
    ? [
        isBlock
          ? "Selection"
          : headerName(summaryFirstColumn) || `Column ${columnLabel(summaryFirstColumn)}`,
        plural(summary.count, "value"),
        ...(summary.numbers > 0
          ? [
              `Sum ${sumFormat.format(summary.sum)}`,
              `Avg ${sumFormat.format(summary.sum / summary.numbers)}`,
            ]
          : []),
      ].join(" · ")
    : "";

  return (
    <div ref={gridRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-3 py-1 text-xs">
        <span className="w-9 shrink-0 font-mono text-muted-foreground">
          {selected ? `${columnLabel(selected.column)}${selected.row + 1}` : ""}
        </span>
        <span className="min-w-16 flex-1 truncate">{readout}</span>
        <div className="w-36">
          <Input
            size="compact"
            type="search"
            aria-label="Search sheet"
            placeholder="Search"
            value={ui.view.search}
            onChange={(event) => updateView((view) => ({ ...view, search: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Escape" && ui.view.search !== "") {
                event.preventDefault();
                updateView((view) => ({ ...view, search: "" }));
              }
            }}
          />
        </div>
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={ui.frozenColumn ? "secondary" : "ghost"}
                size="icon-xs"
                aria-pressed={ui.frozenColumn}
                aria-label="Freeze first column"
                onClick={() =>
                  updateUi((current) => ({ ...current, frozenColumn: !current.frozenColumn }))
                }
              />
            }
          >
            <PanelLeftIcon />
          </TooltipTrigger>
          <TooltipPopup>Freeze first column</TooltipPopup>
        </Tooltip>
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
        view={viewRows}
        widths={widths}
        frozenColumn={ui.frozenColumn}
        editable={editable}
        selected={selected}
        anchor={anchor}
        editing={editing}
        sheetView={ui.view}
        onSort={setSort}
        onFilter={setFilter}
        onSelect={select}
        onResize={(column, width) =>
          updateUi((current) => {
            const { [column]: _removed, ...rest } = current.widths;
            return { ...current, widths: width === null ? rest : { ...rest, [column]: width } };
          })
        }
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
      <div
        role="status"
        className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 px-3 text-xs text-muted-foreground"
      >
        <span className="tabular-nums">
          {filteredBy
            ? `${countFormat.format(viewRows.shown)} of ${plural(viewRows.total, "row")}`
            : plural(viewRows.total, "row")}
        </span>
        {filteredBy ? (
          <Button
            variant="ghost-muted"
            size="micro"
            onClick={() => updateView((view) => ({ ...view, filters: {}, search: "" }))}
          >
            <XIcon />
            Clear filters
          </Button>
        ) : null}
        {sort ? (
          <span className="flex items-center gap-1">
            {sort.direction === "asc" ? (
              <ArrowUpIcon className="size-3" />
            ) : (
              <ArrowDownIcon className="size-3" />
            )}
            Sorted by {headerName(sort.column) || `column ${columnLabel(sort.column)}`}
            <Button variant="ghost-muted" size="micro" onClick={() => setSort(sort.column, null)}>
              Clear sort
            </Button>
            {canApplySort ? (
              <Button variant="ghost-muted" size="micro" onClick={applySort}>
                Apply to file
              </Button>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto min-w-0 truncate tabular-nums">{summaryLabel}</span>
      </div>
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
