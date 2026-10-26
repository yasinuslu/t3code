import { type GrowCard, growStageOf } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as GrowService from "../../../grow/GrowService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { invalid } from "../threadStatus/storeFile.ts";
import { newCommandId, readCaller, readWritableThread, unavailable } from "../../threadAccess.ts";
import { threadStatusOf } from "../brainstorm/handlers.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { GrowToolkit } from "./tools.ts";

const entryOf = (card: GrowCard) => ({
  threadId: card.threadId,
  stage: card.stage ?? null,
  became: card.became ?? null,
  lessons: card.lessons,
  decision: card.decision ?? null,
  parentThreadId: card.parentThreadId ?? null,
});

export const layer = McpToolAccess.toLayer(GrowToolkit, {
  grow_update: McpToolAccess.writes((input) =>
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
  ),

  grow_request_close: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readWritableThread();
      const open = (projection.thread.growRequests ?? []).filter(
        (request) => request.closedAt === undefined,
      );
      const request =
        input.requestId === undefined
          ? open.at(-1)
          : open.find((candidate) => candidate.id === input.requestId);
      if (request === undefined) {
        return yield* invalid(
          input.requestId === undefined
            ? "This thread has no open Grow request."
            : `No open Grow request ${input.requestId} on this thread.`,
        );
      }
      const engine = yield* Orchestrator.OrchestratorV2;
      yield* engine
        .dispatch({
          type: "thread.grow-request.close",
          commandId: yield* newCommandId(),
          threadId: projection.thread.id,
          requestId: request.id,
          outcome: input.outcome,
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        })
        .pipe(Effect.mapError(unavailable));
      return { requestId: request.id, outcome: input.outcome };
    }),
  ),

  grow_board: McpToolAccess.reads(() =>
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
  ),
});
