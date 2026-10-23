import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/** Longest status report a thread keeps; the card shows a digest of it. */
export const THREAD_STATUS_REPORT_MAX_CHARS = 8_000;

/**
 * What a report says about the user. `needs-you`: they owe a decision, an answer or a merge OK,
 * so the thread waits on them and never settles on its own. `done`: the work's result has
 * landed (merged and live, a report delivered, a card written) and nothing is needed, so the
 * thread settles itself once its turn ends.
 */
export const ThreadStatusOutcome = Schema.Literals(["needs-you", "done"]);
export type ThreadStatusOutcome = typeof ThreadStatusOutcome.Type;

/**
 * The status an agent set on its thread (`thread_status_update`), written like
 * a final report: a first paragraph, a "What changed" list, screenshots and a
 * "Needs you" section. Each update replaces the last. Screenshots it embeds
 * are copied into T3 storage and referenced as `attachment:<id>`.
 */
export const ThreadStatusReport = Schema.Struct({
  text: Schema.String,
  updatedAt: IsoDateTime,
  outcome: Schema.optional(ThreadStatusOutcome),
});
export type ThreadStatusReport = typeof ThreadStatusReport.Type;

const PROOF_IMAGE = /\]\(<?(?:attachment:[\w-]+|\/[^)\s>]+\.(?:png|jpe?g|gif|webp))>?\)/i;

/** Whether a status report embeds a proof image (a stored screenshot or an image path). */
export function threadStatusReportHasProof(text: string): boolean {
  return PROOF_IMAGE.test(text);
}

const NEEDS_YOU_HEADING = /^#{1,6}\s*needs you\b.*$/im;
/** A "Needs you" section that says there is nothing to do. */
const NOTHING_NEEDED =
  /^(?:[-*]\s*)?(?:_|\*)?(?:nothing|none|no action|no decision|nothing needed|n\/a)\b/i;

/**
 * The outcome a report states: the one its agent passed, else read off its `## Needs you`
 * section, which the report format reserves for what the user owes. A section with content
 * (other than "nothing") is `needs-you`; no section, or an empty one, states nothing.
 */
export function threadStatusReportOutcome(
  report: Pick<ThreadStatusReport, "text" | "outcome">,
): ThreadStatusOutcome | null {
  if (report.outcome !== undefined) return report.outcome;
  const heading = NEEDS_YOU_HEADING.exec(report.text);
  if (heading === null) return null;
  const rest = report.text.slice(heading.index + heading[0].length);
  const body = rest.split(/^#{1,6}\s/m)[0]?.trim() ?? "";
  if (body === "" || NOTHING_NEEDED.test(body)) return null;
  return "needs-you";
}
