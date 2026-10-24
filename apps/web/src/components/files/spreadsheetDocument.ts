import {
  delimitedTextStyle,
  parseDelimited,
  serializeDelimited,
} from "@t3tools/shared/delimitedPreview";
import type { CellObject, Range, WorkBook, WorkSheet } from "xlsx";

/**
 * The editable model behind the spreadsheet grid. A sheet is a dense array of rows of SheetJS
 * cell objects, so a formula, its cached value and its number format ride along untouched
 * until the user edits that very cell. CSV uses the same shape with plain string cells, so the
 * grid has one code path for both.
 */
export interface SheetData {
  name: string;
  rows: Array<Array<CellObject | undefined>>;
  columns: number;
  /** Column widths in px, when the file or the content suggests them. */
  widths: ReadonlyArray<number>;
  merges: Range[];
  rowHeights: Array<{ hpx?: number; hpt?: number; hidden?: boolean } | undefined>;
  hasFormulas: boolean;
  /** Counts row inserts, deletes and reorders, so a view knows when its row order is stale. */
  layout: number;
  /** Edited since load; an untouched sheet is written back exactly as it was read. */
  dirty: boolean;
  /** The sheet as read, kept for its non-cell settings (columns, filters, protection). */
  source: WorkSheet | null;
}

export interface SpreadsheetDocument {
  kind: "csv" | "xlsx";
  sheets: SheetData[];
  /** Counts mutations, so a view can tell when to repaint. */
  revision: number;
  /** What a save will not keep, in plain words; empty when nothing is lost. */
  losses: string[];
  workbook: WorkBook | null;
  csv: { delimiter: "," | "\t"; style: ReturnType<typeof delimitedTextStyle> } | null;
}

const MIN_COLUMN_PX = 56;
const MAX_COLUMN_PX = 320;
const SAMPLE_ROWS = 100;
const HEADER_BUTTONS_PX = 48;

export function cellText(cell: CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w !== undefined) return cell.w;
  return cell.v === undefined || cell.v === null ? "" : String(cell.v);
}

export function cellHasFormula(cell: CellObject | undefined): boolean {
  return typeof cell?.f === "string" && cell.f.length > 0;
}

function sheetWidths(
  rows: SheetData["rows"],
  columns: number,
  source: ReadonlyArray<{ wpx?: number; wch?: number } | undefined> | undefined,
): number[] {
  return Array.from({ length: columns }, (_, column) => {
    const declared = source?.[column];
    if (declared?.wpx) return clamp(declared.wpx);
    if (declared?.wch) return clamp(declared.wch * 7 + 8);
    let longest = 0;
    for (let row = 1; row < Math.min(rows.length, SAMPLE_ROWS); row++) {
      longest = Math.max(longest, cellText(rows[row]?.[column]).length);
    }
    // The header carries the sort and filter buttons, so its text needs room beside them.
    const header = cellText(rows[0]?.[column]).length;
    return clamp(Math.max(longest * 7 + 20, header * 7 + 20 + HEADER_BUTTONS_PX));
  });
}

const clamp = (width: number) =>
  Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, Math.round(width)));

export function createCsvDocument(text: string, delimiter: "," | "\t"): SpreadsheetDocument {
  const { rows: parsed } = parseDelimited(text, delimiter);
  const columns = parsed.reduce((width, row) => Math.max(width, row.length), 0);
  const rows = parsed.map((row) => row.map((value): CellObject => ({ t: "s", v: value })));
  return {
    kind: "csv",
    sheets: [
      {
        name: "Sheet1",
        rows,
        columns,
        widths: sheetWidths(rows, columns, undefined),
        merges: [],
        rowHeights: [],
        hasFormulas: false,
        layout: 0,
        dirty: false,
        source: null,
      },
    ],
    revision: 0,
    losses: [],
    workbook: null,
    csv: { delimiter, style: delimitedTextStyle(text) },
  };
}

export function serializeCsvDocument(doc: SpreadsheetDocument): string {
  const csv = doc.csv;
  const sheet = doc.sheets[0];
  if (!csv || !sheet) throw new Error("Not a CSV document.");
  return serializeDelimited(
    sheet.rows.map((row) => Array.from({ length: sheet.columns }, (_, c) => cellText(row[c]))),
    csv.delimiter,
    csv.style,
  );
}

/** Parts of a workbook the grid cannot write back, named for a human. */
function workbookLosses(workbook: WorkBook, legacy: boolean): string[] {
  const losses: string[] = [];
  const files = Object.keys((workbook as { files?: Record<string, unknown> }).files ?? {});
  const has = (pattern: RegExp) => files.some((name) => pattern.test(name));
  const styles = (
    workbook as {
      Styles?: { Fonts?: unknown[]; Fills?: unknown[]; Borders?: unknown[] };
    }
  ).Styles;
  if (
    legacy ||
    (styles?.Fonts?.length ?? 0) > 1 ||
    (styles?.Fills?.length ?? 0) > 2 ||
    (styles?.Borders?.length ?? 0) > 1
  ) {
    losses.push("fonts, colors and borders");
  }
  if (has(/(^|\/)charts?\//i) || has(/(^|\/)drawings?\//i)) losses.push("charts and drawings");
  if (has(/(^|\/)media\//i)) losses.push("images");
  if (has(/pivot/i)) losses.push("pivot tables");
  if (has(/vbaProject/i)) losses.push("macros");
  return losses;
}

function sheetFromWorksheet(name: string, worksheet: WorkSheet, XLSX: typeof import("xlsx")) {
  const ref = worksheet["!ref"];
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  const rows: SheetData["rows"] = [];
  let hasFormulas = false;
  let columns = 0;
  if (range) {
    // Cells above or left of the range origin are rare; keep positions by padding to it.
    const lastRow = range.e.r;
    const lastColumn = range.e.c;
    columns = lastColumn + 1;
    for (let r = 0; r <= lastRow; r++) {
      const row: Array<CellObject | undefined> = Array.from<CellObject | undefined>({
        length: columns,
      });
      for (let c = 0; c <= lastColumn; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined;
        if (cell) {
          row[c] = cell;
          if (!hasFormulas && cellHasFormula(cell)) hasFormulas = true;
        }
      }
      rows.push(row);
    }
  }
  return {
    name,
    rows,
    columns,
    widths: sheetWidths(rows, columns, worksheet["!cols"]),
    merges: worksheet["!merges"] ?? [],
    rowHeights: (worksheet["!rows"] as SheetData["rowHeights"] | undefined) ?? [],
    hasFormulas,
    layout: 0,
    dirty: false,
    source: worksheet,
  } satisfies SheetData;
}

let loadedXlsx: typeof import("xlsx") | null = null;

/** SheetJS is large, so it loads only when a workbook is actually opened. */
export async function createWorkbookDocument(
  bytes: Uint8Array,
  format: "xlsx" | "xls",
): Promise<SpreadsheetDocument> {
  const XLSX = (loadedXlsx ??= await import("xlsx"));
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    bookFiles: true,
  });
  return {
    kind: "xlsx",
    sheets: workbook.SheetNames.map((name) =>
      sheetFromWorksheet(name, workbook.Sheets[name] as WorkSheet, XLSX),
    ),
    revision: 0,
    losses: workbookLosses(workbook, format === "xls"),
    workbook,
    csv: null,
  };
}

const NUMBER_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** A number stays a number in a workbook, but "007" stays text and a CSV cell is always text. */
function cellFromText(
  doc: SpreadsheetDocument,
  previous: CellObject | undefined,
  text: string,
): CellObject | undefined {
  if (text === "") return undefined;
  if (doc.kind === "xlsx" && NUMBER_PATTERN.test(text)) {
    const value = Number(text);
    const z = previous?.z;
    return { t: "n", v: value, w: z ? formatNumber(z, value) : text, ...(z ? { z } : {}) };
  }
  return { t: "s", v: text };
}

function formatNumber(format: string | number, value: number): string {
  try {
    return loadedXlsx?.SSF.format(format, value) ?? String(value);
  } catch {
    return String(value);
  }
}

function withSheet(
  doc: SpreadsheetDocument,
  sheetIndex: number,
  update: (sheet: SheetData) => SheetData,
): SpreadsheetDocument {
  return {
    ...doc,
    sheets: doc.sheets.map((sheet, index) => (index === sheetIndex ? update(sheet) : sheet)),
    revision: doc.revision + 1,
  };
}

/**
 * Edit one cell. Replacing a formula cell drops its formula; every other cell is untouched.
 * Documents are values: this returns the next one, or the same one when nothing changed.
 */
export function setCellText(
  doc: SpreadsheetDocument,
  sheetIndex: number,
  row: number,
  column: number,
  text: string,
): SpreadsheetDocument {
  const sheet = doc.sheets[sheetIndex];
  if (!sheet || cellText(sheet.rows[row]?.[column]) === text) return doc;
  return withSheet(doc, sheetIndex, (current) => {
    const rows = current.rows.slice();
    while (rows.length <= row) rows.push([]);
    const edited = rows[row]!.slice();
    while (edited.length <= column) edited.push(undefined);
    edited[column] = cellFromText(doc, edited[column], text);
    rows[row] = edited;
    const columns = Math.max(current.columns, column + 1);
    return {
      ...current,
      rows,
      columns,
      widths:
        columns > current.widths.length
          ? [...current.widths, ...Array<number>(columns - current.widths.length).fill(96)]
          : current.widths,
      dirty: true,
    };
  });
}

const shiftRange = (range: Range, from: number, delta: 1 | -1): Range | null => {
  if (delta === 1) {
    return {
      s: { r: range.s.r >= from ? range.s.r + 1 : range.s.r, c: range.s.c },
      e: { r: range.e.r >= from ? range.e.r + 1 : range.e.r, c: range.e.c },
    };
  }
  if (range.s.r === from && range.e.r === from) return null;
  return {
    s: { r: range.s.r > from ? range.s.r - 1 : range.s.r, c: range.s.c },
    e: { r: range.e.r >= from ? range.e.r - 1 : range.e.r, c: range.e.c },
  };
};

/** Insert an empty row before `at` (use `rows.length` to append). */
export function insertRow(
  doc: SpreadsheetDocument,
  sheetIndex: number,
  at: number,
): SpreadsheetDocument {
  return withSheet(doc, sheetIndex, (sheet) => {
    const index = Math.min(Math.max(at, 0), sheet.rows.length);
    return {
      ...sheet,
      rows: sheet.rows.toSpliced(index, 0, []),
      rowHeights: sheet.rowHeights.toSpliced(index, 0, undefined),
      merges: sheet.merges.flatMap((range) => shiftRange(range, index, 1) ?? []),
      layout: sheet.layout + 1,
      dirty: true,
    };
  });
}

export function deleteRow(
  doc: SpreadsheetDocument,
  sheetIndex: number,
  at: number,
): SpreadsheetDocument {
  const sheet = doc.sheets[sheetIndex];
  if (!sheet || at < 0 || at >= sheet.rows.length) return doc;
  return withSheet(doc, sheetIndex, (current) => ({
    ...current,
    rows: current.rows.toSpliced(at, 1),
    rowHeights: current.rowHeights.toSpliced(at, 1),
    merges: current.merges.flatMap((range) => shiftRange(range, at, -1) ?? []),
    layout: current.layout + 1,
    dirty: true,
  }));
}

/** Whether rows below the header can move: a merge across them has no meaning after a reorder. */
export function canReorderRows(sheet: SheetData): boolean {
  return sheet.merges.every((range) => range.e.r === 0);
}

/**
 * Write a new row order into the sheet. `order` lists the source rows below the header in
 * their new sequence and must name each of them exactly once; the header stays row 0.
 */
export function reorderRows(
  doc: SpreadsheetDocument,
  sheetIndex: number,
  order: ReadonlyArray<number>,
): SpreadsheetDocument {
  const sheet = doc.sheets[sheetIndex];
  if (!sheet || !canReorderRows(sheet) || order.length !== sheet.rows.length - 1) return doc;
  const seen = new Set(order);
  if (seen.size !== order.length || order.some((row) => row < 1 || row >= sheet.rows.length)) {
    return doc;
  }
  if (order.every((row, index) => row === index + 1)) return doc;
  return withSheet(doc, sheetIndex, (current) => ({
    ...current,
    rows: [current.rows[0]!, ...order.map((row) => current.rows[row]!)],
    rowHeights:
      current.rowHeights.length > 0
        ? [current.rowHeights[0], ...order.map((row) => current.rowHeights[row])]
        : current.rowHeights,
    layout: current.layout + 1,
    dirty: true,
  }));
}

/** After a save: sheets are written, so a later save starts from what is on disk. */
export function markSaved(doc: SpreadsheetDocument): SpreadsheetDocument {
  return {
    ...doc,
    sheets: doc.sheets.map((sheet) => (sheet.dirty ? { ...sheet, dirty: false } : sheet)),
  };
}

/** Write the workbook. Sheets nobody edited keep their original cells. */
export async function serializeWorkbookDocument(doc: SpreadsheetDocument): Promise<Uint8Array> {
  const workbook = doc.workbook;
  if (!workbook) throw new Error("Not a workbook document.");
  const XLSX = (loadedXlsx ??= await import("xlsx"));
  for (const sheet of doc.sheets) {
    if (!sheet.dirty) continue;
    const worksheet: WorkSheet = {};
    for (const key of Object.keys(sheet.source ?? {})) {
      if (key.startsWith("!"))
        (worksheet as Record<string, unknown>)[key] = (sheet.source as Record<string, unknown>)[
          key
        ];
    }
    let lastRow = -1;
    let lastColumn = -1;
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        worksheet[XLSX.utils.encode_cell({ r, c })] = cell;
        lastRow = Math.max(lastRow, r);
        lastColumn = Math.max(lastColumn, c);
      });
    });
    worksheet["!ref"] =
      lastRow < 0
        ? "A1"
        : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastColumn } });
    if (sheet.merges.length > 0) worksheet["!merges"] = sheet.merges;
    else delete worksheet["!merges"];
    if (sheet.rowHeights.some(Boolean))
      worksheet["!rows"] = sheet.rowHeights as NonNullable<WorkSheet["!rows"]>;
    workbook.Sheets[sheet.name] = worksheet;
  }
  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A1-style column label: 0 → A, 26 → AA. */
export function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}
