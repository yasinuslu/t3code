import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/** Longest status report a thread keeps; the card shows a digest of it. */
export const THREAD_STATUS_REPORT_MAX_CHARS = 8_000;

/**
 * The status an agent set on its thread (`thread_status_update`), written like
 * a final report: a first paragraph, a "What changed" list, screenshots and a
 * "Needs you" section. Each update replaces the last. Screenshots it embeds
 * are copied into T3 storage and referenced as `attachment:<id>`.
 */
export const ThreadStatusReport = Schema.Struct({
  text: Schema.String,
  updatedAt: IsoDateTime,
});
export type ThreadStatusReport = typeof ThreadStatusReport.Type;
