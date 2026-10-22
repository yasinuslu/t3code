import * as XLSX from "xlsx";
import { describe, expect, it } from "vite-plus/test";

import {
  base64ToBytes,
  bytesToBase64,
  cellHasFormula,
  cellText,
  columnLabel,
  createCsvDocument,
  createWorkbookDocument,
  deleteRow,
  insertRow,
  markSaved,
  serializeCsvDocument,
  serializeWorkbookDocument,
  setCellText,
} from "./spreadsheetDocument";

/** Sales!D2:D3 are formulas over B and C; Notes is a second sheet nobody edits. */
function workbookBytes(): Uint8Array {
  const sales = XLSX.utils.aoa_to_sheet([
    ["Region", "Units", "Price", "Revenue"],
    ["North", 10, 2.5, null],
    ["South", 4, 3, null],
  ]);
  sales["D2"] = { t: "n", v: 25, f: "B2*C2", z: "0.00", w: "25.00" };
  sales["D3"] = { t: "n", v: 12, f: "B3*C3" };
  sales["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  const notes = XLSX.utils.aoa_to_sheet([
    ["Quarter", "Target"],
    ["Q1", 1000],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sales, "Sales");
  XLSX.utils.book_append_sheet(workbook, notes, "Notes");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const reopen = async (doc: Awaited<ReturnType<typeof createWorkbookDocument>>) =>
  createWorkbookDocument(await serializeWorkbookDocument(doc), "xlsx");

describe("workbook documents", () => {
  it("shows formula cells as their values and knows which cells hold formulas", async () => {
    const doc = await createWorkbookDocument(workbookBytes(), "xlsx");
    const sales = doc.sheets[0]!;
    expect(doc.sheets.map((sheet) => sheet.name)).toEqual(["Sales", "Notes"]);
    expect(cellText(sales.rows[1]![3])).toBe("25.00");
    expect(cellHasFormula(sales.rows[1]![3])).toBe(true);
    expect(cellHasFormula(sales.rows[1]![1])).toBe(false);
    expect(sales.hasFormulas).toBe(true);
    expect(doc.sheets[1]!.hasFormulas).toBe(false);
  });

  it("saves an edit, keeping other sheets, other formulas and merged cells", async () => {
    const opened = await createWorkbookDocument(workbookBytes(), "xlsx");
    const edited = setCellText(opened, 0, 1, 1, "20");
    expect(edited.revision).toBe(1);
    expect(edited.sheets[0]!.dirty).toBe(true);
    expect(edited.sheets[1]!.dirty).toBe(false);

    const saved = await reopen(edited);
    const sales = saved.sheets[0]!;
    expect(sales.rows[1]![1]).toMatchObject({ t: "n", v: 20 });
    // Untouched cells keep their formula and cached value.
    expect(sales.rows[1]![3]).toMatchObject({ f: "B2*C2", v: 25, z: "0.00" });
    expect(sales.rows[2]![3]).toMatchObject({ f: "B3*C3", v: 12 });
    expect(sales.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);
    expect(cellText(saved.sheets[1]!.rows[1]![1])).toBe("1000");
  });

  it("types numbers as numbers, keeps leading zeros as text, and clears on empty", async () => {
    const doc = await createWorkbookDocument(workbookBytes(), "xlsx");
    const next = setCellText(
      setCellText(setCellText(doc, 0, 1, 0, "007"), 0, 2, 0, "3.5"),
      0,
      1,
      2,
      "",
    );
    const sales = (await reopen(next)).sheets[0]!;
    expect(sales.rows[1]![0]).toMatchObject({ t: "s", v: "007" });
    expect(sales.rows[2]![0]).toMatchObject({ t: "n", v: 3.5 });
    expect(sales.rows[1]![2]).toBeUndefined();
  });

  it("replaces a formula with the typed value, and reports no change for the same text", async () => {
    const doc = await createWorkbookDocument(workbookBytes(), "xlsx");
    expect(setCellText(doc, 0, 1, 3, "25.00")).toBe(doc);
    const edited = setCellText(doc, 0, 1, 3, "99");
    expect(cellHasFormula(edited.sheets[0]!.rows[1]![3])).toBe(false);
    expect(cellText(edited.sheets[0]!.rows[1]![3])).toBe("99.00"); // the cell keeps its number format
  });

  it("adds and deletes rows, moving merged cells with them", async () => {
    const doc = await createWorkbookDocument(workbookBytes(), "xlsx");
    const inserted = setCellText(insertRow(doc, 0, 1), 0, 1, 0, "East");
    expect(inserted.sheets[0]!.rows.map((row) => cellText(row[0]))).toEqual([
      "Region",
      "East",
      "North",
      "South",
    ]);
    const below = insertRow(doc, 0, 0);
    expect(below.sheets[0]!.merges).toEqual([{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }]);

    const removed = deleteRow(doc, 0, 1);
    const saved = (await reopen(removed)).sheets[0]!;
    expect(saved.rows.map((row) => cellText(row[0]))).toEqual(["Region", "South"]);
    expect(deleteRow(doc, 0, 9)).toBe(doc);
  });

  it("does not rewrite sheets nobody touched, and marks written sheets clean", async () => {
    const doc = await createWorkbookDocument(workbookBytes(), "xlsx");
    const original = doc.workbook!.Sheets["Notes"];
    const edited = setCellText(doc, 0, 1, 1, "21");
    await serializeWorkbookDocument(edited);
    expect(doc.workbook!.Sheets["Notes"]).toBe(original);
    expect(markSaved(edited).sheets.some((sheet) => sheet.dirty)).toBe(false);
  });

  it("warns about formatting a legacy .xls cannot keep, and about nothing for a plain .xlsx", async () => {
    expect((await createWorkbookDocument(workbookBytes(), "xlsx")).losses).toEqual([]);
    expect((await createWorkbookDocument(workbookBytes(), "xls")).losses).toEqual([
      "fonts, colors and borders",
    ]);
  });
});

describe("csv documents", () => {
  it("edits one cell and writes the file back in its own style", () => {
    const text = '\ufeffname,notes\r\n"A, B",x\r\nC,y\r\n';
    const doc = createCsvDocument(text, ",");
    expect(serializeCsvDocument(doc)).toBe(text);
    const edited = setCellText(doc, 0, 2, 1, 'say "hi"');
    expect(serializeCsvDocument(edited)).toBe('\ufeffname,notes\r\n"A, B",x\r\nC,"say ""hi"""\r\n');
    const grown = setCellText(insertRow(edited, 0, 1), 0, 1, 0, "new");
    expect(serializeCsvDocument(grown)).toContain("\r\nnew,\r\n");
  });
});

describe("helpers", () => {
  it("labels columns like a spreadsheet and round-trips base64", () => {
    expect([0, 25, 26, 701, 702].map(columnLabel)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
