import { describe, expect, it } from "vite-plus/test";

import {
  cellText,
  createCsvDocument,
  deleteRow,
  reorderRows,
  setCellText,
  type SheetData,
} from "./spreadsheetDocument";
import {
  columnFacets,
  columnKind,
  computeView,
  EMPTY_VIEW,
  fold,
  parseDate,
  parseNumber,
  rangeToTsv,
  sortedBodyOrder,
  summarize,
  type SheetView,
} from "./spreadsheetView";

const sheetOf = (csv: string): SheetData => createCsvDocument(csv, ",").sheets[0]!;

/** Body cell texts of one column, in display order. */
const column = (sheet: SheetData, view: SheetView, index: number): string[] =>
  computeView(sheet, view)
    .rows.slice(1)
    .map((row) => cellText(sheet.rows[row]?.[index]));

const sortBy = (columnIndex: number, direction: "asc" | "desc" = "asc"): SheetView => ({
  ...EMPTY_VIEW,
  sort: { column: columnIndex, direction },
});

describe("sorting", () => {
  it("orders Turkish text by the Turkish alphabet", () => {
    const sheet = sheetOf(
      "Name\nZeynep\nÇağla\nAhmet\nŞule\nSevgi\nÖmer\nOya\nÜmit\nUgur\nİpek\nIşık\nIrmak\nGül\nGuz",
    );
    expect(column(sheet, sortBy(0), 0)).toEqual([
      "Ahmet",
      "Çağla",
      "Guz",
      "Gül",
      "Irmak",
      "Işık",
      "İpek",
      "Oya",
      "Ömer",
      "Sevgi",
      "Şule",
      "Ugur",
      "Ümit",
      "Zeynep",
    ]);
  });

  it("sorts numbers by value, not by their digits", () => {
    const sheet = sheetOf('Qty\n10\n9\n100\n-5\n2.5\n"1,5"');
    expect(columnKind(sheet, 0)).toBe("number");
    expect(column(sheet, sortBy(0), 0)).toEqual(["-5", "1,5", "2.5", "9", "10", "100"]);
    expect(column(sheet, sortBy(0, "desc"), 0)).toEqual(["100", "10", "9", "2.5", "1,5", "-5"]);
  });

  it("sorts dates written in ISO and day-first form on one timeline", () => {
    const sheet = sheetOf("Due\n2026-12-01\n05.03.2026\n2026-01-15\n31/12/2025");
    expect(columnKind(sheet, 0)).toBe("date");
    expect(column(sheet, sortBy(0), 0)).toEqual([
      "31/12/2025",
      "2026-01-15",
      "05.03.2026",
      "2026-12-01",
    ]);
  });

  it("keeps blanks last in both directions and breaks ties by file order", () => {
    const sheet = sheetOf("Key,Tag\n3,a\n,b\n1,c\n3,d");
    expect(column(sheet, sortBy(0), 1)).toEqual(["c", "a", "d", "b"]);
    expect(column(sheet, sortBy(0, "desc"), 1)).toEqual(["a", "d", "c", "b"]);
  });

  it("puts text after numbers in a mostly numeric column", () => {
    const sheet = sheetOf("V\n3\nn/a\n1\n2\n4\n5\n6\n7\n8\n9");
    expect(columnKind(sheet, 0)).toBe("number");
    expect(column(sheet, sortBy(0), 0).at(-1)).toBe("n/a");
  });

  it("never moves the header row", () => {
    const sheet = sheetOf("Name\nb\na");
    expect(computeView(sheet, sortBy(0)).rows).toEqual([0, 2, 1]);
  });
});

describe("filtering and search", () => {
  const sheet = sheetOf(
    "City,Pop\nİstanbul,15000\nIsparta,260\nAnkara,5700\nİzmir,4300\nistanbul köyü,12\n,\nBursa,3100",
  );

  it("hides excluded values and counts what is left", () => {
    const view: SheetView = {
      ...EMPTY_VIEW,
      filters: { 0: { exclude: new Set(["Ankara", "Bursa"]) } },
    };
    const result = computeView(sheet, view);
    expect(result.total).toBe(7);
    expect(result.shown).toBe(5);
    expect(column(sheet, view, 0)).toEqual(["İstanbul", "Isparta", "İzmir", "istanbul köyü", ""]);
  });

  it("matches contains without regard to case, accents or the dotted İ", () => {
    const view: SheetView = { ...EMPTY_VIEW, filters: { 0: { contains: "ISTANBUL" } } };
    expect(column(sheet, view, 0).filter(Boolean)).toEqual(["İstanbul", "istanbul köyü"]);
    expect(fold("İzmir")).toBe(fold("izmir"));
    expect(fold("ISPARTA")).toBe(fold("ısparta"));
  });

  it("filters a number column by range", () => {
    const view: SheetView = { ...EMPTY_VIEW, filters: { 1: { min: 4000, max: 6000 } } };
    expect(column(sheet, view, 0).filter(Boolean)).toEqual(["Ankara", "İzmir"]);
    expect(
      column(sheet, { ...EMPTY_VIEW, filters: { 1: { min: 5000 } } }, 0).filter(Boolean),
    ).toEqual(["İstanbul", "Ankara"]);
  });

  it("combines filters from several columns with the quick search", () => {
    const view: SheetView = {
      ...EMPTY_VIEW,
      search: "iz",
      filters: { 1: { min: 4000 } },
    };
    expect(column(sheet, view, 0).filter(Boolean)).toEqual(["İzmir"]);
  });

  it("needs every search word, which may sit in different columns", () => {
    const view: SheetView = { ...EMPTY_VIEW, search: "ISTANBUL 15000" };
    expect(column(sheet, view, 0).filter(Boolean)).toEqual(["İstanbul"]);
    expect(
      column(sheet, { ...EMPTY_VIEW, search: "  ankara   izmir " }, 0).filter(Boolean),
    ).toEqual([]);
  });

  it("keeps empty rows visible so a new row is never hidden", () => {
    const view: SheetView = { ...EMPTY_VIEW, filters: { 0: { contains: "zzz" } } };
    expect(column(sheet, view, 0)).toEqual([""]);
  });

  it("filters first and then sorts what is left", () => {
    const view: SheetView = {
      sort: { column: 1, direction: "desc" },
      filters: { 0: { contains: "i" } },
      search: "",
    };
    expect(column(sheet, view, 0).filter(Boolean)).toEqual([
      "İstanbul",
      "İzmir",
      "Isparta",
      "istanbul köyü",
    ]);
  });

  it("lists distinct values in the column's order with counts, ignoring its own filter", () => {
    const rows = sheetOf("Team\nçay\nCam\nçay\nDağ\n\nCam\nCam");
    const view: SheetView = { ...EMPTY_VIEW, filters: { 0: { exclude: new Set(["Dağ"]) } } };
    expect(columnFacets(rows, view, 0)).toEqual([
      { value: "Cam", count: 3 },
      { value: "çay", count: 2 },
      { value: "Dağ", count: 1 },
    ]);
  });

  it("narrows a column's list by the other columns' filters", () => {
    const rows = sheetOf("Team,Size\nA,1\nB,9\nA,9");
    const view: SheetView = { ...EMPTY_VIEW, filters: { 1: { min: 5 } } };
    expect(columnFacets(rows, view, 0)).toEqual([
      { value: "A", count: 1 },
      { value: "B", count: 1 },
    ]);
  });
});

describe("editing through a view", () => {
  const csv = "Name,Score\nCem,3\nAda,9\nBora,1\nDila,7";

  it("writes an edit to the source cell the display row stands for", () => {
    const doc = createCsvDocument(csv, ",");
    const view = computeView(doc.sheets[0]!, {
      sort: { column: 1, direction: "desc" },
      filters: { 1: { min: 3 } },
      search: "",
    });
    // Display: header, Ada 9, Dila 7, Cem 3. The second body row is Dila.
    const source = view.rows[2]!;
    expect(cellText(doc.sheets[0]!.rows[source]![0])).toBe("Dila");
    const edited = setCellText(doc, 0, source, 1, "70");
    const rows = edited.sheets[0]!.rows;
    expect(rows.map((row) => `${cellText(row[0])}:${cellText(row[1])}`)).toEqual([
      "Name:Score",
      "Cem:3",
      "Ada:9",
      "Bora:1",
      "Dila:70",
    ]);
  });

  it("finds a selected cell again by its source row after the view changes", () => {
    const sheet = sheetOf(csv);
    const sourceOfAda = 2;
    const byScore = computeView(sheet, sortBy(1, "desc"));
    const byName = computeView(sheet, sortBy(0));
    expect(byScore.positions[sourceOfAda]).toBe(1);
    expect(byName.positions[sourceOfAda]).toBe(1);
    expect(computeView(sheet, { ...EMPTY_VIEW, search: "bora" }).positions[sourceOfAda]).toBe(-1);
  });

  it("writes a sort into the file only when asked, as a pure reorder", () => {
    const doc = createCsvDocument(csv, ",");
    const sheet = doc.sheets[0]!;
    expect(sheet.dirty).toBe(false);
    const order = sortedBodyOrder(sheet, { column: 0, direction: "asc" });
    const sorted = reorderRows(doc, 0, order);
    const names = sorted.sheets[0]!.rows.map((row) => cellText(row[0]));
    expect(names).toEqual(["Name", "Ada", "Bora", "Cem", "Dila"]);
    expect(sorted.sheets[0]!.dirty).toBe(true);
    expect(sorted.sheets[0]!.layout).toBe(1);
    // Cells travel with their rows.
    expect(cellText(sorted.sheets[0]!.rows[3]![1])).toBe("3");
  });

  it("refuses a reorder that is not a permutation of the body rows", () => {
    const doc = createCsvDocument(csv, ",");
    expect(reorderRows(doc, 0, [1, 1, 2, 3])).toBe(doc);
    expect(reorderRows(doc, 0, [1, 2, 3])).toBe(doc);
    expect(reorderRows(doc, 0, [1, 2, 3, 4])).toBe(doc);
  });

  it("marks structural edits so a view knows its order is stale", () => {
    const doc = createCsvDocument(csv, ",");
    expect(deleteRow(doc, 0, 1).sheets[0]!.layout).toBe(1);
    expect(setCellText(doc, 0, 1, 1, "5").sheets[0]!.layout).toBe(0);
  });
});

describe("summaries and copying", () => {
  const sheet = sheetOf("Item,Price\nA,10\nB,2.5\nC,\nD,x");

  it("counts filled cells and sums the numeric ones", () => {
    expect(summarize(sheet, [1, 2, 3, 4], 1, 1)).toEqual({ count: 3, numbers: 2, sum: 12.5 });
  });

  it("sums only the rows it is given, so a filtered view sums what it shows", () => {
    expect(summarize(sheet, [2], 1, 1)).toEqual({ count: 1, numbers: 1, sum: 2.5 });
  });

  it("copies a range as tab-separated text, quoting cells that need it", () => {
    const odd = sheetOf('A,B\n"x\ty","say ""hi"""\n"two\nlines",z');
    expect(rangeToTsv(odd, [1, 2], 0, 1)).toBe('"x\ty"\t"say ""hi"""\n"two\nlines"\tz');
    expect(rangeToTsv(sheet, [2, 1], 0, 1)).toBe("B\t2.5\nA\t10");
  });
});

describe("number and date parsing", () => {
  it("reads plain numbers and decimal commas only", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" -3,5 ")).toBe(-3.5);
    expect(parseNumber("1e3")).toBe(1000);
    expect(parseNumber("12abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("rejects dates that do not exist", () => {
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("31.04.2026")).toBeNull();
    expect(parseDate("2026-02-28")).toBe(Date.UTC(2026, 1, 28));
  });
});
