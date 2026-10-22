import { useState } from "react";

import { SpreadsheetEditor } from "./SpreadsheetEditor";
import { createCsvDocument, serializeCsvDocument } from "./spreadsheetDocument";

/**
 * CSV and TSV as a grid. With `onTextChange` the cells are editable and every edit hands back
 * the whole file as text, in the line ending and quoting style it was read in; without it the
 * grid is read-only.
 */
export function DelimitedTablePreview(props: {
  readonly name: string;
  readonly text: string;
  readonly delimiter: "," | "\t";
  readonly onTextChange?: (text: string) => void;
}) {
  // `source` is the text the document was built from or last wrote, so a text prop that
  // matches it is our own save coming back and anything else is a change from outside.
  const [state, setState] = useState(() => ({
    source: props.text,
    doc: createCsvDocument(props.text, props.delimiter),
  }));
  let { doc } = state;
  if (props.text !== state.source) {
    doc = createCsvDocument(props.text, props.delimiter);
    setState({ source: props.text, doc });
  }
  const { onTextChange } = props;
  return (
    <SpreadsheetEditor
      name={props.name}
      doc={doc}
      {...(onTextChange
        ? {
            onChange: (next) => {
              const text = serializeCsvDocument(next);
              setState({ source: text, doc: next });
              onTextChange(text);
            },
          }
        : {})}
    />
  );
}
