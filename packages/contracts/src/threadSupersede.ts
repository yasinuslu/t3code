import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId } from "./baseSchemas.ts";

/** Longest supersede note a thread keeps: one line on why, and what carried over. */
export const THREAD_SUPERSEDE_NOTE_MAX_CHARS = 280;

/**
 * The thread that took this thread's work further, set when the thread is let
 * go in favour of it. The reverse ("supersedes") is derived from the other
 * threads' links, so a chain reads oldest to newest like a thought maturing.
 */
export const ThreadSupersededBy = Schema.Struct({
  threadId: ThreadId,
  note: Schema.String,
  at: IsoDateTime,
});
export type ThreadSupersededBy = typeof ThreadSupersededBy.Type;
