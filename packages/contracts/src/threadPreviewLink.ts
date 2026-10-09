import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A running build of a thread's work (a dev server or prototype) that the user can open,
 * attached by the agent (`link_preview`), found in the agent's report, or added by the user.
 */
export const ThreadPreviewLinkSource = Schema.Literals(["agent", "report", "user"]);
export type ThreadPreviewLinkSource = typeof ThreadPreviewLinkSource.Type;

export const ThreadPreviewLink = Schema.Struct({
  url: TrimmedNonEmptyString,
  label: Schema.optional(TrimmedNonEmptyString),
  source: ThreadPreviewLinkSource,
  linkedAt: IsoDateTime,
});
export type ThreadPreviewLink = typeof ThreadPreviewLink.Type;

/**
 * A preview host may answer `GET <origin>/.well-known/preview-status` with
 * `{"state": "running"|"starting"|"stopped"|"failed"|"gone"}` without waking the preview.
 * Hosts that do not implement it report `unknown`.
 */
export const PREVIEW_STATUS_PATH = "/.well-known/preview-status";

export const ThreadPreviewLinkState = Schema.Literals([
  "running",
  "starting",
  "stopped",
  "failed",
  "gone",
  "unknown",
]);
export type ThreadPreviewLinkState = typeof ThreadPreviewLinkState.Type;

export const PreviewLinkStatusInput = Schema.Struct({
  urls: Schema.Array(TrimmedNonEmptyString),
});
export type PreviewLinkStatusInput = typeof PreviewLinkStatusInput.Type;

export const PreviewLinkStatusResult = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({ url: TrimmedNonEmptyString, state: ThreadPreviewLinkState }),
  ),
});
export type PreviewLinkStatusResult = typeof PreviewLinkStatusResult.Type;
