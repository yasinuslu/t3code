import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSurfaceFailure, FileSurfaceLoading } from "./fileSurfaceChrome";
import { SpreadsheetEditor } from "./SpreadsheetEditor";
import {
  base64ToBytes,
  bytesToBase64,
  createWorkbookDocument,
  markSaved,
  serializeWorkbookDocument,
  type SpreadsheetDocument,
} from "./spreadsheetDocument";

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly doc: SpreadsheetDocument }
  | { readonly status: "failed"; readonly message: string };

function openFailureMessage(cause: unknown): string {
  const detail = cause instanceof Error ? ` ${cause.message}` : "";
  return `This workbook could not be opened.${detail}`;
}

function lossNotice(doc: SpreadsheetDocument, format: "xlsx" | "xls"): string | null {
  if (doc.losses.length === 0 && format === "xlsx") return null;
  const kept = "Values, formulas, number formats, merged cells and column widths are kept.";
  const lost = doc.losses.length > 0 ? ` ${doc.losses.join(", ")} are not kept when you save.` : "";
  const legacy =
    format === "xls"
      ? " Saving writes a new .xlsx next to this file and leaves the .xls as it is."
      : "";
  return `${kept}${lost}${legacy}`;
}

/**
 * A workbook that is only looked at: an attachment, or a file outside the workspace. The bytes
 * arrive from the caller; SheetJS loads on the first open.
 */
export function WorkbookPreview(props: {
  readonly name: string;
  readonly format: "xlsx" | "xls";
  readonly bytes: Uint8Array;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const { bytes, format } = props;
  useEffect(() => {
    let cancelled = false;
    createWorkbookDocument(bytes, format).then(
      (doc) => {
        if (!cancelled) setLoaded({ status: "ready", doc });
      },
      (cause: unknown) => {
        if (!cancelled) setLoaded({ status: "failed", message: openFailureMessage(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bytes, format]);
  if (loaded.status === "loading") return <FileSurfaceLoading />;
  if (loaded.status === "failed") return <FileSurfaceFailure message={loaded.message} />;
  return <SpreadsheetEditor name={props.name} doc={loaded.doc} />;
}

/**
 * A workspace workbook you can edit. `contents` is the file's bytes as base64, straight from
 * the read; Save writes the whole workbook back through the same file API. A change that lands
 * on disk while nothing is unsaved reloads the grid; one that lands over unsaved edits waits
 * for the user, because Save overwrites it either way.
 */
export function WorkbookFileSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly format: "xlsx" | "xls";
  readonly contents: string;
  readonly readOnly: boolean;
  readonly refresh: () => void;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onPendingChange: (relativePath: string, pending: boolean) => void;
}) {
  const { environmentId, cwd, relativePath, format, contents, readOnly } = props;
  const { refresh, onOpenFile, onPendingChange } = props;
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // The bytes the grid currently reflects, so our own save coming back is not a reload.
  const syncedContents = useRef<string | null>(null);

  const doc = loaded.status === "ready" ? loaded.doc : null;
  const dirty = doc !== null && doc.revision !== savedRevision;
  const latest = useRef({ doc, dirty, saving });
  useEffect(() => {
    latest.current = { doc, dirty, saving };
  });

  useEffect(() => {
    if (contents === syncedContents.current || latest.current.dirty) return;
    syncedContents.current = contents;
    let cancelled = false;
    let settled = false;
    createWorkbookDocument(base64ToBytes(contents), format).then(
      (next) => {
        settled = true;
        if (cancelled) return;
        setLoaded({ status: "ready", doc: next });
        setSavedRevision(next.revision);
      },
      (cause: unknown) => {
        settled = true;
        if (!cancelled) setLoaded({ status: "failed", message: openFailureMessage(cause) });
      },
    );
    return () => {
      cancelled = true;
      // A load that never finished (a replayed effect) must run again for the same bytes.
      if (!settled) syncedContents.current = null;
    };
  }, [contents, format]);

  const save = useCallback(async () => {
    const { doc: current, saving: busy } = latest.current;
    if (!current || busy || readOnly) return;
    setSaving(true);
    try {
      const base64 = bytesToBase64(await serializeWorkbookDocument(current));
      const target = format === "xls" ? relativePath.replace(/\.xls$/i, ".xlsx") : relativePath;
      const result = await writeFile({
        environmentId,
        input: { cwd, relativePath: target, contents: base64, encoding: "base64" },
      });
      if (result._tag !== "Success") return;
      setNoticeDismissed(true);
      setLoaded((state) =>
        state.status === "ready" && state.doc.revision === current.revision
          ? { status: "ready", doc: markSaved(state.doc) }
          : state,
      );
      setSavedRevision(current.revision);
      if (target === relativePath) {
        syncedContents.current = base64;
        refresh();
      } else {
        toastManager.add({ type: "success", title: `Saved as ${target}` });
        onOpenFile(target);
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not save workbook",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }, [cwd, environmentId, format, onOpenFile, readOnly, refresh, relativePath, writeFile]);

  useEffect(() => {
    onPendingChange(relativePath, dirty);
    return () => onPendingChange(relativePath, false);
  }, [dirty, onPendingChange, relativePath]);

  // Leaving the file with edits saves them, like the text editor does. A legacy .xls would
  // have to open its .xlsx copy, so its edits are dropped with the view instead.
  const saveOnLeave = useRef(() => {});
  useEffect(() => {
    saveOnLeave.current = () => {
      if (format === "xlsx") void save();
    };
  });
  useEffect(
    () => () => {
      if (latest.current.dirty) saveOnLeave.current();
    },
    [],
  );

  if (loaded.status === "loading") return <FileSurfaceLoading />;
  if (loaded.status === "failed") return <FileSurfaceFailure message={loaded.message} />;
  return (
    <SpreadsheetEditor
      name={relativePath}
      doc={loaded.doc}
      notice={noticeDismissed || readOnly ? null : lossNotice(loaded.doc, format)}
      onDismissNotice={() => setNoticeDismissed(true)}
      {...(readOnly
        ? {}
        : {
            onChange: (next: SpreadsheetDocument) => setLoaded({ status: "ready", doc: next }),
            onSave: () => void save(),
            dirty,
            saving,
          })}
    />
  );
}
