import { describe, expect, it } from "vite-plus/test";
import {
  delimitedTextStyle,
  filePreviewDelimiter,
  parseDelimited,
  parseDelimitedPreview,
  serializeDelimited,
} from "./delimitedPreview.ts";

describe("delimited file previews", () => {
  it("respects a specific MIME type before the extension", () => {
    expect(filePreviewDelimiter({ name: "data.CSV", mimeType: "text/plain" })).toBe(",");
    expect(filePreviewDelimiter({ name: "data.csv", mimeType: "application/pdf" })).toBeNull();
  });
  it("preserves quoted separators, escaped quotes, blank cells and line breaks", () => {
    expect(
      parseDelimitedPreview('\ufeffname,notes,empty\r\n"A, B","say ""hi""\nagain",\r\n', ","),
    ).toEqual({
      rows: [
        ["name", "notes", "empty"],
        ["A, B", 'say "hi"\nagain', ""],
      ],
      truncated: false,
    });
    expect(parseDelimitedPreview("one\ttwo\n\tthree", "\t").rows).toEqual([
      ["one", "two"],
      ["", "three"],
    ]);
  });
  describe.each([",", "\t"] as const)("with delimiter %j", (delimiter) => {
    it("preserves a final quoted empty record without requiring a line ending", () => {
      for (const ending of ["", "\n", "\r\n"]) {
        expect(parseDelimitedPreview(`name\r\nAlice\r\n""${ending}`, delimiter)).toEqual({
          rows: [["name"], ["Alice"], [""]],
          truncated: false,
        });
      }
      expect(parseDelimitedPreview('""', delimiter)).toEqual({
        rows: [[""]],
        truncated: false,
      });
    });
    it("does not invent records for empty input or a trailing line ending", () => {
      for (const prefix of ["", "\ufeff"]) {
        expect(parseDelimitedPreview(prefix, delimiter).rows).toEqual([]);
        expect(parseDelimitedPreview(`${prefix}name\r\n`, delimiter).rows).toEqual([["name"]]);
        expect(parseDelimitedPreview(`${prefix}""`, delimiter).rows).toEqual([[""]]);
      }
    });
    it("keeps a quoted empty record at the row limit", () => {
      const text = `${"name\n".repeat(99)}""`;
      const preview = parseDelimitedPreview(text, delimiter);
      expect(preview.rows).toHaveLength(100);
      expect(preview.rows.at(-1)).toEqual([""]);
      expect(preview.truncated).toBe(false);
      expect(parseDelimitedPreview(`${text}\nextra`, delimiter).truncated).toBe(true);
    });
  });
  it("bounds rows, columns and cell length and reports partial content", () => {
    const table = parseDelimitedPreview(
      Array.from({ length: 101 }, () =>
        Array.from({ length: 31 }, () => "x".repeat(2001)).join(","),
      ).join("\n"),
      ",",
    );
    expect(table.truncated).toBe(true);
    expect(table.rows).toHaveLength(100);
    expect(table.rows[0]).toHaveLength(30);
    expect(table.rows[0]?.[0]).toHaveLength(2000);
    expect(parseDelimitedPreview('a,"unfinished', ",").truncated).toBe(true);
  });
});

describe("full delimited text", () => {
  it("parses without bounds and writes back in the file's own style", () => {
    const wide = Array.from({ length: 40 }, (_, index) => `c${index}`).join(",");
    const rows = Array.from({ length: 150 }, () => wide);
    const text = `${rows.join("\r\n")}\r\n`;
    const parsed = parseDelimited(text, ",");
    expect(parsed.truncated).toBe(false);
    expect(parsed.rows).toHaveLength(150);
    expect(parsed.rows[0]).toHaveLength(40);
    expect(serializeDelimited(parsed.rows, ",", delimitedTextStyle(text))).toBe(text);
  });
  it.each([
    ["LF, no final newline", "a,b\n1,2"],
    ["CRLF with a BOM", "\ufeffa,b\r\n1,2\r\n"],
    ["quotes, delimiters and line breaks", 'name,notes\n"A, B","say ""hi""\nagain"\n'],
    ["blank and ragged rows", "a,b,c\n\n1\n,,\n"],
    ["a lone empty record", 'x\n""'],
  ])("round-trips %s", (_label, text) => {
    const { rows } = parseDelimited(text, ",");
    expect(serializeDelimited(rows, ",", delimitedTextStyle(text))).toBe(text);
  });
  it("quotes only what needs it and keeps tab files tab-separated", () => {
    const style = { eol: "\n" as const, bom: false, finalNewline: true };
    expect(serializeDelimited([["a,b", "c"]], "\t", style)).toBe("a,b\tc\n");
    expect(serializeDelimited([["a\tb", 'q"']], "\t", style)).toBe('"a\tb"\t"q"""\n');
  });
});
