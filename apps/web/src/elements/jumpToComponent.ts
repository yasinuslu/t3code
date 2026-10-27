/**
 * Finding the component a reply answers. A reply carries only the component's question (see
 * `formatComponentAnswer`), so the source is the nearest earlier assistant message or
 * `render_component` row that holds it.
 */
import { normalizeComponentQuestion } from "@t3tools/client-runtime/user-message";

interface TimelineRowLike {
  readonly id: string;
  readonly kind: string;
  readonly message?: { readonly role: string; readonly text: string };
  /** Set on a `render_component` row. */
  readonly propsJson?: string | null;
}

/** The part of a question that survives quote softening and JSON escaping in the message text. */
function questionNeedle(question: string): string {
  return question.split("'")[0]?.slice(0, 60) ?? "";
}

/** Id of the nearest row above `fromRowId` that holds a component asking `question`. */
export function findComponentSourceRowId(
  rows: ReadonlyArray<TimelineRowLike>,
  fromRowId: string,
  question: string,
): string | null {
  const needle = questionNeedle(question);
  if (needle === "") return null;
  for (let index = rows.findIndex((row) => row.id === fromRowId) - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "component" && row.propsJson?.replace(/\s+/g, " ").includes(needle)) {
      return row.id;
    }
    if (row?.kind !== "message" || row.message?.role !== "assistant") continue;
    const text = row.message.text;
    if (text.includes("<t3-") && text.replace(/\s+/g, " ").includes(needle)) return row.id;
  }
  return null;
}

const FLASH_MS = 1600;
const MOUNT_WAIT_FRAMES = 40;

/**
 * Scrolls the component asking `question` inside timeline row `rowId` into view and marks it for
 * a moment. The row may still be mounting after a virtualized scroll, so it waits a few frames.
 */
export function flashComponent(rowId: string, question: string): void {
  let frames = 0;
  const attempt = () => {
    const row = Array.from(document.querySelectorAll("[data-timeline-row-id]")).find(
      (candidate) => candidate.getAttribute("data-timeline-row-id") === rowId,
    );
    const target = row
      ? Array.from(row.querySelectorAll("[data-t3-question]")).find(
          (candidate) =>
            normalizeComponentQuestion(candidate.getAttribute("data-t3-question") ?? "") ===
            question,
        )
      : undefined;
    if (!(target instanceof HTMLElement)) {
      frames += 1;
      if (frames < MOUNT_WAIT_FRAMES) requestAnimationFrame(attempt);
      return;
    }
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    target.setAttribute("data-t3-flash", "");
    window.setTimeout(() => target.removeAttribute("data-t3-flash"), FLASH_MS);
  };
  requestAnimationFrame(attempt);
}
