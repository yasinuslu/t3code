// @effect-diagnostics nodeBuiltinImport:off
/**
 * Grow: the cards of the board on Home. A card holds only what a person or an
 * agent set on a thread (an override stage, what it became, lessons, the
 * regroup decision); everything else the board derives from the thread itself.
 * Cards persist in `grow.json` in the state directory.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  type GrowCard,
  GrowCard as GrowCardSchema,
  GrowDecision,
  GrowStage,
  type GrowState,
  type GrowUpdateInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

const encodeFile = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ cards: Schema.Array(GrowCardSchema) })),
);
const isStage = Schema.is(GrowStage);
const isDecision = Schema.is(GrowDecision);

/**
 * One stored card, keeping the fields that still make sense and ignoring the
 * rest, so a schema change never costs the whole board. Null when the card
 * names no thread.
 */
export function salvageGrowCard(raw: unknown): GrowCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.threadId !== "string" || record.threadId === "") return null;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const stage = isStage(record.stage) ? record.stage : undefined;
  const decision = isDecision(record.decision) ? record.decision : undefined;
  const became = text(record.became);
  const parent = text(record.parentThreadId);
  return {
    threadId: ThreadId.make(record.threadId),
    lessons: Array.isArray(record.lessons)
      ? record.lessons.filter((lesson): lesson is string => typeof lesson === "string")
      : [],
    updatedAt: text(record.updatedAt) ?? "",
    ...(stage === undefined ? {} : { stage }),
    ...(became === undefined ? {} : { became }),
    ...(decision === undefined ? {} : { decision }),
    ...(parent === undefined ? {} : { parentThreadId: ThreadId.make(parent) }),
  };
}

/** The cards in a file's text; null when the text is not a board file at all. */
export function parseGrowFile(text: string): Map<ThreadId, GrowCard> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const cards = (parsed as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) return null;
  const result = new Map<ThreadId, GrowCard>();
  for (const raw of cards) {
    const card = salvageGrowCard(raw);
    if (card !== null) result.set(card.threadId, card);
  }
  return result;
}

const cleaned = (values: ReadonlyArray<string>): string[] => [
  ...new Set(values.map((value) => value.trim()).filter((value) => value !== "")),
];

/** The card after an update; a pure merge so the rules stay testable. */
export function applyGrowUpdate(
  current: GrowCard | undefined,
  input: GrowUpdateInput,
  now: string,
): GrowCard {
  let stage = current?.stage;
  let decision = current?.decision;
  let parentThreadId = current?.parentThreadId;
  let became = current?.became;
  let lessons = current?.lessons ?? [];

  if (input.stage !== undefined) stage = input.stage ?? undefined;
  if (input.decision !== undefined) {
    decision = input.decision ?? undefined;
    if (decision === "shelve" || decision === "pivot") stage = "shelved";
    // The derived stage (building) shows once the play and regroup overrides are gone.
    if (decision === "adopt" && (stage === "play" || stage === "regroup")) stage = undefined;
  }
  if (input.parentThreadId !== undefined) parentThreadId = input.parentThreadId ?? undefined;
  if (input.became !== undefined) became = input.became.trim() || undefined;
  if (input.lessons !== undefined) lessons = cleaned(input.lessons);
  if (input.addLessons !== undefined) lessons = cleaned([...lessons, ...input.addLessons]);

  return {
    threadId: input.threadId,
    lessons,
    updatedAt: now,
    ...(stage === undefined ? {} : { stage }),
    ...(became === undefined ? {} : { became }),
    ...(decision === undefined ? {} : { decision }),
    ...(parentThreadId === undefined ? {} : { parentThreadId }),
  };
}

export class GrowService extends Context.Service<
  GrowService,
  {
    readonly state: Effect.Effect<GrowState>;
    /** Merges the input into the thread's card, creating it if needed. */
    readonly update: (input: GrowUpdateInput) => Effect.Effect<GrowCard>;
    /** Current state first, then every change. */
    readonly changes: Stream.Stream<GrowState>;
  }
>()("t3/grow/GrowService") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const statePath = NodePath.join(config.stateDir, "grow.json");

  // A missing file starts the board empty. A file that is not a board at all
  // does too, but stays untouched until the first update, which keeps it as
  // grow.json.bad first; one unusable card never costs the others.
  const text = yield* Effect.promise(() => NodeFSP.readFile(statePath, "utf8").catch(() => ""));
  const parsed = parseGrowFile(text);
  const keepBadFile = yield* Ref.make(parsed === null && text.trim() !== "");
  const cardsRef = yield* Ref.make(parsed ?? new Map<ThreadId, GrowCard>());
  const writeLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<GrowState>(16);

  const toState = (cards: ReadonlyMap<ThreadId, GrowCard>): GrowState => ({
    cards: [...cards.values()],
  });
  const state = Ref.get(cardsRef).pipe(Effect.map(toState));

  const save = (cards: ReadonlyMap<ThreadId, GrowCard>) =>
    Effect.gen(function* () {
      const keep = yield* Ref.getAndSet(keepBadFile, false);
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(statePath), { recursive: true });
        if (keep) await NodeFSP.copyFile(statePath, `${statePath}.bad`).catch(() => undefined);
        const temp = `${statePath}.${process.pid}.tmp`;
        await NodeFSP.writeFile(temp, `${encodeFile(toState(cards))}\n`);
        await NodeFSP.rename(temp, statePath);
      });
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("could not save grow state", { cause })),
    );

  const update: GrowService["Service"]["update"] = (input) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const cards = yield* Ref.get(cardsRef);
        const now = DateTime.formatIso(yield* DateTime.now);
        const card = applyGrowUpdate(cards.get(input.threadId), input, now);
        const next = new Map(cards).set(card.threadId, card);
        yield* Ref.set(cardsRef, next);
        yield* save(next);
        yield* PubSub.publish(changes, toState(next));
        return card;
      }),
    );

  const stream: GrowService["Service"]["changes"] = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const first = yield* state;
      return Stream.concat(Stream.make(first), Stream.fromSubscription(subscription));
    }),
  );

  return GrowService.of({ state, update, changes: stream });
});

export const layer = Layer.effect(GrowService, make);
