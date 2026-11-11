import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

export const ContextBreakdownCategoryKind = Schema.Literals(["used", "free", "buffer", "deferred"]);
export type ContextBreakdownCategoryKind = typeof ContextBreakdownCategoryKind.Type;

export const ContextBreakdownCategory = Schema.Struct({
  /** Provider row id such as `system_prompt` or `mcp_tools`; null when the provider sends none. */
  id: Schema.NullOr(Schema.String),
  name: Schema.String,
  tokens: Schema.Number,
  kind: ContextBreakdownCategoryKind,
});
export type ContextBreakdownCategory = typeof ContextBreakdownCategory.Type;

export const ContextBreakdownItem = Schema.Struct({
  name: Schema.String,
  /** The MCP server, memory file type, or skill/agent source. */
  detail: Schema.optional(Schema.String),
  tokens: Schema.Number,
});
export type ContextBreakdownItem = typeof ContextBreakdownItem.Type;

export const ContextBreakdown = Schema.Struct({
  model: Schema.String,
  totalTokens: Schema.Number,
  maxTokens: Schema.Number,
  autoCompactThreshold: Schema.optional(Schema.Number),
  categories: Schema.Array(ContextBreakdownCategory),
  /** Each list is sorted by tokens, largest first. */
  mcpTools: Schema.Array(ContextBreakdownItem),
  memoryFiles: Schema.Array(ContextBreakdownItem),
  skills: Schema.Array(ContextBreakdownItem),
  agents: Schema.Array(ContextBreakdownItem),
  fetchedAt: Schema.String,
});
export type ContextBreakdown = typeof ContextBreakdown.Type;

export const ThreadContextBreakdownInput = Schema.Struct({ threadId: ThreadId });
export type ThreadContextBreakdownInput = typeof ThreadContextBreakdownInput.Type;

export const ThreadContextBreakdownUnavailableReason = Schema.Literals([
  /** No provider process is running for the thread, so there is nothing to measure. */
  "no-session",
  /** The provider reports only a used/max total. */
  "provider-unsupported",
]);
export type ThreadContextBreakdownUnavailableReason =
  typeof ThreadContextBreakdownUnavailableReason.Type;

export const ThreadContextBreakdownResult = Schema.Union([
  Schema.TaggedStruct("available", { breakdown: ContextBreakdown }),
  Schema.TaggedStruct("unavailable", { reason: ThreadContextBreakdownUnavailableReason }),
]);
export type ThreadContextBreakdownResult = typeof ThreadContextBreakdownResult.Type;

export class ThreadContextBreakdownError extends Schema.TaggedError<ThreadContextBreakdownError>()(
  "ThreadContextBreakdownError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "The provider could not report the context breakdown.";
  }
}
