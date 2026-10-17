import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId } from "./baseSchemas.ts";

/**
 * Grow: every thread is a card moving through the owner's loop, from an idea
 * to a playable thing, what was learned from it, the regroup decision and
 * what ended up built on main. The server stores only what people and agents
 * set; a card with no stored stage gets one derived from the thread (see
 * `growStageOf`).
 */

/** In board order; the one list of stage ids. */
export const GROW_STAGES = [
  "idea",
  "exploring",
  "play",
  "regroup",
  "building",
  "done",
  "shelved",
] as const;
export const GrowStage = Schema.Literals(GROW_STAGES);
export type GrowStage = typeof GrowStage.Type;

export const GrowDecision = Schema.Literals(["adopt", "pivot", "shelve"]);
export type GrowDecision = typeof GrowDecision.Type;

export const GrowCard = Schema.Struct({
  threadId: ThreadId,
  /** An override; unset, the stage is derived from the thread. */
  stage: Schema.optional(GrowStage),
  /** One line on what the thread turned into. */
  became: Schema.optional(Schema.String),
  /** What the user learned, liked or disliked, in their words. */
  lessons: Schema.Array(Schema.String),
  decision: Schema.optional(GrowDecision),
  /** The thread this one branched from. */
  parentThreadId: Schema.optional(ThreadId),
  updatedAt: IsoDateTime,
});
export type GrowCard = typeof GrowCard.Type;

export const GrowState = Schema.Struct({
  cards: Schema.Array(GrowCard),
});
export type GrowState = typeof GrowState.Type;

export const GrowUpdateInput = Schema.Struct({
  threadId: ThreadId,
  /** Null clears the override so the stage is derived again. */
  stage: Schema.optional(Schema.NullOr(GrowStage)),
  became: Schema.optional(Schema.String),
  /** Replaces all lessons. */
  lessons: Schema.optional(Schema.Array(Schema.String)),
  /** Appends lessons that are not there yet. */
  addLessons: Schema.optional(Schema.Array(Schema.String)),
  decision: Schema.optional(Schema.NullOr(GrowDecision)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type GrowUpdateInput = typeof GrowUpdateInput.Type;

export interface GrowStageFacts {
  readonly hasPlayable: boolean;
  readonly working: boolean;
  readonly merged: boolean;
  readonly settled: boolean;
}

/** The stage a card is shown in. */
export function growStageOf(
  card: Pick<GrowCard, "stage" | "decision"> | undefined,
  facts: GrowStageFacts,
): GrowStage {
  if (card?.stage === "shelved") return "shelved";
  if (facts.merged) return "done";
  if (card?.stage !== undefined) return card.stage;
  if (card?.decision === "adopt") return "building";
  if (facts.settled) return "done";
  if (facts.hasPlayable && !facts.working) return "play";
  return "exploring";
}
