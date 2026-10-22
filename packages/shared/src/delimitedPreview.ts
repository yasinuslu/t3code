/** A table preview is bounded independently of the source preview's byte limit. */
export function filePreviewDelimiter(file: { name: string; mimeType?: string }): "," | "\t" | null {
  const mime = file.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "text/csv") return ",";
  if (mime === "text/tab-separated-values") return "\t";
  if (mime && mime !== "text/plain" && mime !== "application/octet-stream") return null;
  if (/\.csv$/i.test(file.name)) return ",";
  if (/\.tsv$/i.test(file.name)) return "\t";
  return null;
}

const PREVIEW_LIMITS = { rows: 100, columns: 30, cell: 2000 };

/** Preserve quoted delimiters, escaped quotes and multiline cells; raw mode retains all text. */
export function parseDelimitedPreview(text: string, delimiter: "," | "\t") {
  return parseDelimited(text, delimiter, PREVIEW_LIMITS);
}

/** Every row and cell of the text, unbounded unless `limits` says otherwise. */
export function parseDelimited(
  text: string,
  delimiter: "," | "\t",
  limits: { rows: number; columns: number; cell: number } = {
    rows: Infinity,
    columns: Infinity,
    cell: Infinity,
  },
) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  let rowStart = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endCell = () => {
    if (row.length < limits.columns) row.push(cell);
    else truncated = true;
    cell = "";
  };
  for (let index = rowStart; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        if (cell.length < limits.cell) cell += '"';
        else truncated = true;
        index++;
        continue;
      }
      if (quoted || cell === "") {
        quoted = !quoted;
        continue;
      }
    }
    if (!quoted && (char === delimiter || char === "\n" || char === "\r")) {
      endCell();
      if (char !== delimiter) {
        rows.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index++;
        rowStart = index + 1;
        if (rows.length === limits.rows) {
          return { rows, truncated: truncated || index < text.length - 1 };
        }
      }
    } else if (cell.length < limits.cell) cell += char;
    else truncated = true;
  }
  if (rowStart < text.length) {
    endCell();
    rows.push(row);
  }
  return { rows, truncated: truncated || quoted };
}

/** The line ending, byte-order mark and final newline a file used, so a save keeps them. */
export function delimitedTextStyle(text: string) {
  return {
    eol: /\r\n/.test(text)
      ? ("\r\n" as const)
      : /\r(?!\n)/.test(text)
        ? ("\r" as const)
        : ("\n" as const),
    bom: text.charCodeAt(0) === 0xfeff,
    finalNewline: /[\r\n]$/.test(text),
  };
}

/** Quote only what needs it: the delimiter, a quote, or a line break. */
export function serializeDelimited(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  delimiter: "," | "\t",
  style: ReturnType<typeof delimitedTextStyle>,
): string {
  // A blank line is a row of one empty cell. Only a last one with no line ending after it
  // needs quotes, or the file would simply end before it.
  const field = (value: string, quoteEmpty: boolean) =>
    value.includes(delimiter) || /["\r\n]/.test(value) || (quoteEmpty && value === "")
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  const body = rows
    .map((row, index) =>
      row
        .map((value) =>
          field(value, row.length === 1 && index === rows.length - 1 && !style.finalNewline),
        )
        .join(delimiter),
    )
    .join(style.eol);
  return `${style.bom ? "\ufeff" : ""}${body}${style.finalNewline && rows.length > 0 ? style.eol : ""}`;
}
