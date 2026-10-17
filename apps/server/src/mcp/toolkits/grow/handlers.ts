import { type GrowCard, growStageOf } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as GrowService from "../../../grow/GrowService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { readCaller, readWritableThread, unavailable } from "../../threadAccess.ts";
import { threadStatusOf } from "../brainstorm/handlers.ts";
import { GrowToolkit } from "./tools.ts";

const entryOf = (card: GrowCard) => ({
  threadId: card.threadId,
  stage: card.stage ?? null,
  became: card.became ?? null,
  lessons: card.lessons,
  decision: card.decision ?? null,
  parentThreadId: card.parentThreadId ?? null,
});

export const GrowToolkitHandlersLive = GrowToolkit.toLayer({
  grow_update: (input) =>
    Effect.gen(function* () {
      const grow = yield* GrowService.GrowService;
      const { projection } = yield* readWritableThread(input.threadId);
      const card = yield* grow.update({
        threadId: projection.thread.id,
        ...(input.stage === undefined ? {} : { stage: input.stage }),
        ...(input.became === undefined ? {} : { became: input.became }),
        ...(input.addLessons === undefined ? {} : { addLessons: input.addLessons }),
        ...(input.decision === undefined ? {} : { decision: input.decision }),
        ...(input.parentThreadId === undefined ? {} : { parentThreadId: input.parentThreadId }),
      });
      return entryOf(card);
    }),

  grow_board: () =>
    Effect.gen(function* () {
      const grow = yield* GrowService.GrowService;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const { reach } = yield* readCaller();
      const snapshot = yield* orchestrator
        .getShellSnapshot({ location: "active" })
        .pipe(Effect.mapError(unavailable));
      const cards = new Map((yield* grow.state).cards.map((card) => [card.threadId, card]));
      return {
        cards: snapshot.threads
          .filter(
            (thread) =>
              thread.deletedAt === null &&
              thread.lineage.relationshipToParent !== "subagent" &&
              (reach === null || reach.has(thread.projectId)),
          )
          .map((thread) => {
            const card = cards.get(thread.id);
            const status = threadStatusOf(thread);
            const shownStage = growStageOf(card, {
              hasPlayable: (thread.previewLinks ?? []).length > 0,
              working: status === "working",
              merged: (thread.pullRequests ?? []).some(
                (pullRequest) => pullRequest.snapshot?.state === "merged",
              ),
              settled: status === "settled",
            });
            return {
              ...entryOf(card ?? { threadId: thread.id, lessons: [], updatedAt: "" }),
              title: thread.title,
              shownStage,
            };
          }),
      };
    }),
});
