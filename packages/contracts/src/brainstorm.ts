import * as Schema from "effect/Schema";

import { ProjectId, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Brainstorm: the manager chat (the All space's chat, working in the default
 * profile's knowledge base, "brain") and the goal and task lists kept as
 * markdown in each brain repository.
 *
 * Spaces themselves live in the client; it mirrors them to the server so the
 * agent's tools can be scoped to a space.
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
   * profile a symlink directly under `~/code` points into, else the first.
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

export const BrainstormThreadReportInput = Schema.Struct({
  threadId: ThreadId,
  /** The run the client last saw; a new run is a new report. */
  runId: Schema.optional(Schema.NullOr(RunId)),
});
export type BrainstormThreadReportInput = typeof BrainstormThreadReportInput.Type;

/** A thread's latest report: the last answer of its newest runs that has one. */
export const BrainstormThreadReport = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  /** Capped; null before the thread's first answer. */
  text: Schema.NullOr(Schema.String),
});
export type BrainstormThreadReport = typeof BrainstormThreadReport.Type;

export const BrainstormTask = Schema.Struct({
  /** 1-based position in its file; changes when tasks above it are added or removed. */
  number: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  threadIds: Schema.Array(Schema.String),
  /** Title of the goal the task is under ("Inbox" for loose tasks). */
  goal: Schema.String,
});
export type BrainstormTask = typeof BrainstormTask.Type;

export const BrainstormGoal = Schema.Struct({
  /** 1-based position in its file. */
  number: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
  notes: Schema.Array(Schema.String),
});
export type BrainstormGoal = typeof BrainstormGoal.Type;

export const BrainstormTaskList = Schema.Struct({
  spaceId: Schema.String,
  spaceName: Schema.String,
  /** Absolute path of the markdown file; null when the space has no brain to keep it in. */
  path: Schema.NullOr(Schema.String),
  /** Code profile whose brain keeps the file; null for lists of custom spaces and Other. */
  profile: Schema.NullOr(Schema.String),
  goals: Schema.Array(BrainstormGoal),
  tasks: Schema.Array(BrainstormTask),
});
export type BrainstormTaskList = typeof BrainstormTaskList.Type;

export const BrainstormState = Schema.Struct({
  /** Brainstorm threads by space; the All space's is the manager thread. */
  threadIdsBySpaceId: Schema.Record(Schema.String, ThreadId),
  /**
   * Brainstorm chats clients hide from thread lists: every one but the manager,
   * including ones for a brain a space no longer uses.
   */
  hiddenThreadIds: Schema.Array(ThreadId),
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
    /** Goal title; the Inbox when unset. */
    goal: Schema.optional(TrimmedNonEmptyString),
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
  Schema.Struct({
    type: Schema.Literal("set-goal-done"),
    goal: TrimmedNonEmptyString,
    done: Schema.Boolean,
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
