import type { CellObject } from "xlsx";

import { cellText, type SheetData } from "./spreadsheetDocument";

/**
 * The view over a sheet: which source rows show, and in what order. It never changes the
 * sheet. Rows are named by their index in `SheetData.rows` (the "source row"), so a selection
 * or an edit keeps pointing at the same cell however the view is sorted or filtered. Row 0
 * is the header: it is always shown first and is never sorted, filtered or searched.
 */

export type ColumnKind = "number" | "date" | "text";

export interface SortState {
  readonly column: number;
  readonly direction: "asc" | "desc";
}

export interface ColumnFilter {
  /** Values, as displayed, the user switched off. A value typed later stays visible. */
  readonly exclude?: ReadonlySet<string>;
  /** Case, accent and Turkish İ/ı insensitive substring. */
  readonly contains?: string;
  readonly min?: number;
  readonly max?: number;
}

export interface SheetView {
  readonly sort: SortState | null;
  readonly filters: Readonly<Record<number, ColumnFilter>>;
  readonly search: string;
}

export const EMPTY_VIEW: SheetView = { sort: null, filters: {}, search: "" };

export interface ViewRows {
  /** Display position to source row, header first: `rows[0]` is always 0. */
  readonly rows: ReadonlyArray<number>;
  /** Source row to display position, -1 when the row is filtered out. */
  readonly positions: ReadonlyArray<number>;
  /** Body rows in the sheet and body rows that pass the filters. */
  readonly total: number;
  readonly shown: number;
}

export function filterIsActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  return (
    (filter.exclude?.size ?? 0) > 0 ||
    (filter.contains ?? "") !== "" ||
    filter.min !== undefined ||
    filter.max !== undefined
  );
}

export function activeFilterCount(view: SheetView): number {
  return Object.values(view.filters).filter(filterIsActive).length;
}

export function viewIsFiltered(view: SheetView): boolean {
  return activeFilterCount(view) > 0 || view.search.trim() !== "";
}

/** Case and accent folding that treats Turkish İ, I, ı and i as one letter for matching. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase();
}

const NUMBER_TEXT = /^[+-]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i;
const DATE_TEXT_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?/;
const DATE_TEXT_DMY = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

/** A decimal comma counts, so a Turkish "1,5" sorts as 1.5. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function utc(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  // Date.UTC rolls 31 February over to March; refuse that.
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? time : null;
}

/** ISO `2026-10-23` and day-first `23.10.2026` or `23/10/2026`, as milliseconds. */
export function parseDate(text: string): number | null {
  const trimmed = text.trim();
  const iso = DATE_TEXT_ISO.exec(trimmed);
  if (iso) return utc(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = DATE_TEXT_DMY.exec(trimmed);
  if (dmy) return utc(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(format: string | number | undefined): boolean {
  if (format === undefined) return false;
  if (typeof format === "number") return BUILT_IN_DATE_FORMATS.has(format);
  const bare = format
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[ymdhs]/i.test(bare) && !/^general$/i.test(bare);
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function numberOf(cell: CellObject | undefined): number | null {
  if (!cell) return null;
  if (cell.t === "n")
    return isDateFormat(cell.z) ? null : typeof cell.v === "number" ? cell.v : null;
  if (cell.t === "s") return parseNumber(String(cell.v ?? ""));
  return null;
}

function dateOf(cell: CellObject | undefined): number | null {
  if (!cell) return null;
  if (cell.t === "d") return cell.v instanceof Date ? cell.v.getTime() : null;
  if (cell.t === "n") {
    return isDateFormat(cell.z) && typeof cell.v === "number"
      ? EXCEL_EPOCH_MS + cell.v * DAY_MS
      : null;
  }
  if (cell.t === "s") return parseDate(String(cell.v ?? ""));
  return null;
}

/** The column's type, from the cells under the header: what most of them are. */
export function columnKind(sheet: SheetData, column: number): ColumnKind {
  let numbers = 0;
  let dates = 0;
  let filled = 0;
  for (let row = 1; row < sheet.rows.length; row++) {
    const cell = sheet.rows[row]?.[column];
    if (cellText(cell) === "") continue;
    filled++;
    if (dateOf(cell) !== null) dates++;
    else if (numberOf(cell) !== null) numbers++;
  }
  if (filled === 0) return "text";
  if (dates / filled >= 0.8) return "date";
  if (numbers / filled >= 0.8) return "number";
  return "text";
}

interface SortKey {
  readonly blank: boolean;
  /** NaN when the cell is not a number or date in a numeric column. */
  readonly n: number;
  readonly s: string;
}

function keyOf(cell: CellObject | undefined, kind: ColumnKind): SortKey {
  const s = cellText(cell);
  if (s === "") return { blank: true, n: Number.NaN, s };
  const n = kind === "number" ? numberOf(cell) : kind === "date" ? dateOf(cell) : null;
  return { blank: false, n: n ?? Number.NaN, s };
}

const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const collators = new Map<string, Intl.Collator>();

function collatorFor(turkish: boolean): Intl.Collator {
  const locale = turkish ? "tr" : "default";
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(turkish ? "tr" : undefined, { numeric: true });
    collators.set(locale, collator);
  }
  return collator;
}

/** Ascending order; blanks are handled by the caller so they stay last in both directions. */
function compareKeys(a: SortKey, b: SortKey, collator: Intl.Collator): number {
  const aNumeric = !Number.isNaN(a.n);
  const bNumeric = !Number.isNaN(b.n);
  if (aNumeric && bNumeric) return a.n - b.n;
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return collator.compare(a.s, b.s);
}

function orderByKeys(
  keys: ReadonlyArray<SortKey>,
  direction: "asc" | "desc",
  collator: Intl.Collator,
): number[] {
  const sign = direction === "asc" ? 1 : -1;
  const index = keys.map((_, position) => position);
  index.sort((left, right) => {
    const a = keys[left]!;
    const b = keys[right]!;
    if (a.blank || b.blank) return a.blank === b.blank ? left - right : a.blank ? 1 : -1;
    return compareKeys(a, b, collator) * sign || left - right;
  });
  return index;
}

function sortRows(sheet: SheetData, rows: ReadonlyArray<number>, sort: SortState): number[] {
  const kind = columnKind(sheet, sort.column);
  let turkish = false;
  const keys = rows.map((row) => {
    const key = keyOf(sheet.rows[row]?.[sort.column], kind);
    if (!turkish && TURKISH_LETTERS.test(key.s)) turkish = true;
    return key;
  });
  return orderByKeys(keys, sort.direction, collatorFor(turkish)).map((position) => rows[position]!);
}

function bodyRows(sheet: SheetData): number[] {
  return Array.from({ length: Math.max(sheet.rows.length - 1, 0) }, (_, index) => index + 1);
}

/** The body rows in file order after sorting, for writing the sort into the file. */
export function sortedBodyOrder(sheet: SheetData, sort: SortState): number[] {
  return sortRows(sheet, bodyRows(sheet), sort);
}

const searchTextCache = new WeakMap<ReadonlyArray<CellObject | undefined>, string>();

/** One folded string per row, kept while the row is untouched, so a keystroke is a scan. */
function searchTextOf(row: ReadonlyArray<CellObject | undefined>): string {
  let text = searchTextCache.get(row);
  if (text === undefined) {
    text = "";
    for (const cell of row) text += `${fold(cellText(cell))}\u0001`;
    searchTextCache.set(row, text);
  }
  return text;
}

function rowIsBlank(row: ReadonlyArray<CellObject | undefined>): boolean {
  return row.every((cell) => cellText(cell) === "");
}

function matchesFilter(cell: CellObject | undefined, filter: ColumnFilter): boolean {
  const text = cellText(cell);
  if (filter.exclude?.has(text)) return false;
  if (filter.contains && !fold(text).includes(fold(filter.contains.trim()))) return false;
  if (filter.min !== undefined || filter.max !== undefined) {
    const value = numberOf(cell);
    if (value === null) return false;
    if (filter.min !== undefined && value < filter.min) return false;
    if (filter.max !== undefined && value > filter.max) return false;
  }
  return true;
}

function passes(
  row: ReadonlyArray<CellObject | undefined>,
  filters: ReadonlyArray<readonly [number, ColumnFilter]>,
  words: ReadonlyArray<string>,
): boolean {
  // An empty row has nothing to match: it stays, so a row just added is never hidden.
  if (rowIsBlank(row)) return true;
  if (words.length > 0) {
    const text = searchTextOf(row);
    if (!words.every((word) => text.includes(word))) return false;
  }
  return filters.every(([column, filter]) => matchesFilter(row[column], filter));
}

const activeFilters = (view: SheetView, except?: number) =>
  Object.entries(view.filters)
    .map(([column, filter]) => [Number(column), filter] as const)
    .filter(([column, filter]) => column !== except && filterIsActive(filter));

/** Every word of the search must appear somewhere in the row, in any column. */
const searchWords = (view: SheetView) => fold(view.search).split(/\s+/).filter(Boolean);

export function computeView(sheet: SheetData, view: SheetView): ViewRows {
  if (sheet.rows.length === 0) return { rows: [], positions: [], total: 0, shown: 0 };
  const filters = activeFilters(view);
  const words = searchWords(view);
  let rows = bodyRows(sheet);
  if (filters.length > 0 || words.length > 0) {
    rows = rows.filter((row) => passes(sheet.rows[row] ?? [], filters, words));
  }
  const shown = rows.length;
  if (view.sort) rows = sortRows(sheet, rows, view.sort);
  const display = [0, ...rows];
  const positions = Array.from<number>({ length: sheet.rows.length }).fill(-1);
  display.forEach((row, position) => {
    positions[row] = position;
  });
  return {
    rows: display,
    positions,
    total: Math.max(sheet.rows.length - 1, 0),
    shown,
  };
}

export interface Facet {
  readonly value: string;
  readonly count: number;
}

/**
 * The distinct values of a column for its filter list, in the column's own order, counted over
 * the rows the other filters and the search leave. The column's own filter does not narrow its
 * list, so a value switched off can be switched back on.
 */
export function columnFacets(sheet: SheetData, view: SheetView, column: number): Facet[] {
  const filters = activeFilters(view, column);
  const words = searchWords(view);
  const kind = columnKind(sheet, column);
  const counts = new Map<string, { count: number; key: SortKey }>();
  let turkish = false;
  for (let row = 1; row < sheet.rows.length; row++) {
    const cells = sheet.rows[row] ?? [];
    if (rowIsBlank(cells) || !passes(cells, filters, words)) continue;
    const text = cellText(cells[column]);
    const known = counts.get(text);
    if (known) {
      known.count++;
      continue;
    }
    if (!turkish && TURKISH_LETTERS.test(text)) turkish = true;
    counts.set(text, { count: 1, key: keyOf(cells[column], kind) });
  }
  const entries = [...counts.entries()];
  const order = orderByKeys(
    entries.map(([, entry]) => entry.key),
    "asc",
    collatorFor(turkish),
  );
  return order.map((position) => ({
    value: entries[position]![0],
    count: entries[position]![1].count,
  }));
}

export interface Summary {
  readonly count: number;
  readonly numbers: number;
  readonly sum: number;
}

/** Count of filled cells and the sum of the numeric ones, over display rows and a column span. */
export function summarize(
  sheet: SheetData,
  sourceRows: ReadonlyArray<number>,
  firstColumn: number,
  lastColumn: number,
): Summary {
  let count = 0;
  let numbers = 0;
  let sum = 0;
  for (const row of sourceRows) {
    const cells = sheet.rows[row];
    if (!cells) continue;
    for (let column = firstColumn; column <= lastColumn; column++) {
      const cell = cells[column];
      if (cellText(cell) === "") continue;
      count++;
      const value = numberOf(cell);
      if (value !== null) {
        numbers++;
        sum += value;
      }
    }
  }
  return { count, numbers, sum };
}

const needsQuotes = /[\t\n\r"]/;

/** Tab-separated text for pasting into a spreadsheet app, quoting the cells that need it. */
export function rangeToTsv(
  sheet: SheetData,
  sourceRows: ReadonlyArray<number>,
  firstColumn: number,
  lastColumn: number,
): string {
  return sourceRows
    .map((row) => {
      const cells: string[] = [];
      for (let column = firstColumn; column <= lastColumn; column++) {
        const text = cellText(sheet.rows[row]?.[column]);
        cells.push(needsQuotes.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
      }
      return cells.join("\t");
    })
    .join("\n");
}

export interface CellRef {
  readonly row: number;
  readonly column: number;
}

export interface Span {
  /** Display positions, header included, and columns; both ends inclusive. */
  readonly firstPosition: number;
  readonly lastPosition: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}

/**
 * The selected block as display positions. The selection is kept in source rows so it follows
 * its cells through a sort, and a block runs over the rows that sit between its two corners
 * in the current view. A corner the view hides leaves just the focused cell.
 */
export function selectionSpan(
  view: ViewRows,
  focus: CellRef | null,
  anchor: CellRef | null,
): Span | null {
  const focusPosition = focus ? (view.positions[focus.row] ?? -1) : -1;
  if (!focus || focusPosition < 0) return null;
  const anchorPosition = anchor ? (view.positions[anchor.row] ?? -1) : -1;
  if (!anchor || anchorPosition < 0) {
    return {
      firstPosition: focusPosition,
      lastPosition: focusPosition,
      firstColumn: focus.column,
      lastColumn: focus.column,
    };
  }
  return {
    firstPosition: Math.min(focusPosition, anchorPosition),
    lastPosition: Math.max(focusPosition, anchorPosition),
    firstColumn: Math.min(focus.column, anchor.column),
    lastColumn: Math.max(focus.column, anchor.column),
  };
}
