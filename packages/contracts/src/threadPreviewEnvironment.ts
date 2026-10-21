import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId } from "./baseSchemas.ts";

export const THREAD_PREVIEW_ENVIRONMENT_NOTE_MAX_CHARS = 300;

export const ThreadPreviewEnvironmentStatus = Schema.Literals([
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
]);
export type ThreadPreviewEnvironmentStatus = typeof ThreadPreviewEnvironmentStatus.Type;

/**
 * Where a thread's project-declared preview environment (the `preview` commands in t3.json)
 * stands. The URL itself is a regular preview link; `note` carries the URL while running and
 * the reason when failed.
 */
export const ThreadPreviewEnvironment = Schema.Struct({
  status: ThreadPreviewEnvironmentStatus,
  updatedAt: IsoDateTime,
  note: Schema.optional(
    Schema.String.check(Schema.isMaxLength(THREAD_PREVIEW_ENVIRONMENT_NOTE_MAX_CHARS)),
  ),
});
export type ThreadPreviewEnvironment = typeof ThreadPreviewEnvironment.Type;

export const ThreadPreviewEnvironmentInput = Schema.Struct({
  threadId: ThreadId,
  action: Schema.Literals(["up", "down"]),
});
export type ThreadPreviewEnvironmentInput = typeof ThreadPreviewEnvironmentInput.Type;

export class ThreadPreviewEnvironmentError extends Schema.TaggedError<ThreadPreviewEnvironmentError>()(
  "ThreadPreviewEnvironmentError",
  { message: Schema.String },
) {}
