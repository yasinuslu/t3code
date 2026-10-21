import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/**
 * What the user asked a thread for from Grow. `presentation` and `ship` stay open until the
 * agent answers them (presentation_set, grow_request_close); `change`, `reply` and `form` (the
 * answers to a presentation's form page) carry the user's own words and are answered by the turn
 * they start.
 */
export const GrowRequestKind = Schema.Literals(["presentation", "ship", "change", "reply", "form"]);
export type GrowRequestKind = typeof GrowRequestKind.Type;

/** How an agent answered a request: landed it, or could not and says why. */
export const GrowRequestOutcome = Schema.Literals(["done", "blocked"]);
export type GrowRequestOutcome = typeof GrowRequestOutcome.Type;

/** Most requests a thread remembers; older ones fall off. */
export const THREAD_GROW_REQUESTS_MAX = 6;
/** Longest user text or agent note a request keeps. */
export const THREAD_GROW_REQUEST_TEXT_MAX_CHARS = 280;

export const ThreadGrowRequest = Schema.Struct({
  /** The message context record's id, so the agent names the request it answers. */
  id: Schema.String,
  kind: GrowRequestKind,
  /** The user's words, for a change or a reply. */
  text: Schema.optional(Schema.String),
  openedAt: IsoDateTime,
  closedAt: Schema.optional(IsoDateTime),
  outcome: Schema.optional(GrowRequestOutcome),
  /** The agent's one line on how it went. */
  note: Schema.optional(Schema.String),
});
export type ThreadGrowRequest = typeof ThreadGrowRequest.Type;
