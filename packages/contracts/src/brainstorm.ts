import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Brainstorm: one agent chat per space, working in the space's knowledge base
 * ("brain") repository, plus a markdown task list kept in that repository.
 *
 * Spaces themselves live in the client; it mirrors them to the server so the
 * brainstorm agent's tools can be scoped to its space.
 */

export const BrainstormSpaceKind = Schema.Literals(["all", "other", "profile", "custom"]);
export type BrainstormSpaceKind = typeof BrainstormSpaceKind.Type;

export const BrainstormSpace = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: BrainstormSpaceKind,
  /** Code profile of a profile space. */
  profile: Schema.NullOr(TrimmedNonEmptyString),
});
export type BrainstormSpace = typeof BrainstormSpace.Type;

export const BrainstormSyncSpacesInput = Schema.Struct({
  /** In display order. */
  spaces: Schema.Array(BrainstormSpace),
  /** Custom spaces each of this environment's projects was added to. */
  customSpaceIdsByProjectId: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  /**
   * Code profile whose brain custom spaces, Other and All use. Unset: the
   * first profile space.
   */
  defaultProfile: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type BrainstormSyncSpacesInput = typeof BrainstormSyncSpacesInput.Type;

export const BrainstormOpenInput = Schema.Struct({
  spaceId: TrimmedNonEmptyString,
});
export type BrainstormOpenInput = typeof BrainstormOpenInput.Type;

export const BrainstormOpenResult = Schema.Struct({
  spaceId: Schema.String,
  projectId: ProjectId,
  threadId: ThreadId,
  /** The brain repository the chat works in. */
  brainPath: Schema.String,
});
export type BrainstormOpenResult = typeof BrainstormOpenResult.Type;

export const BrainstormTask = Schema.Struct({
  /** 1-based position in its file; changes when tasks above it are added or removed. */
  number: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  threadIds: Schema.Array(Schema.String),
});
export type BrainstormTask = typeof BrainstormTask.Type;

export const BrainstormTaskList = Schema.Struct({
  spaceId: Schema.String,
  spaceName: Schema.String,
  /** Absolute path of the markdown file; null when the space has no brain to keep it in. */
  path: Schema.NullOr(Schema.String),
  tasks: Schema.Array(BrainstormTask),
});
export type BrainstormTaskList = typeof BrainstormTaskList.Type;

export const BrainstormState = Schema.Struct({
  /** Brainstorm threads by space; clients hide these from thread lists. */
  threadIdsBySpaceId: Schema.Record(Schema.String, ThreadId),
  taskLists: Schema.Array(BrainstormTaskList),
  /** Custom memberships as the server last saw them. */
  customSpaceIdsByProjectId: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  /** Bumped when the agent changes a custom membership; clients then adopt the map above. */
  membershipRevision: Schema.Int,
  /** Code profiles that have a brain, and the one custom spaces, Other and All use. */
  profiles: Schema.Array(Schema.String),
  defaultProfile: Schema.NullOr(Schema.String),
});
export type BrainstormState = typeof BrainstormState.Type;

export const BrainstormTaskMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    title: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("set-done"),
    number: Schema.Int,
    /** Guards against editing a task that moved since the client rendered it. */
    title: Schema.String,
    done: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("delete"),
    number: Schema.Int,
    title: Schema.String,
  }),
]);
export type BrainstormTaskMutation = typeof BrainstormTaskMutation.Type;

export const BrainstormMutateTasksInput = Schema.Struct({
  spaceId: TrimmedNonEmptyString,
  mutation: BrainstormTaskMutation,
});
export type BrainstormMutateTasksInput = typeof BrainstormMutateTasksInput.Type;

export class BrainstormError extends Schema.TaggedError<BrainstormError>()("BrainstormError", {
  message: Schema.String,
}) {}
