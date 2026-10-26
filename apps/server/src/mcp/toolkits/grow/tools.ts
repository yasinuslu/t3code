import {
  GrowDecision,
  GrowRequestOutcome,
  GrowStage,
  OrchestratorMcpFailure,
  THREAD_GROW_REQUEST_TEXT_MAX_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as GrowService from "../../../grow/GrowService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagerScope from "../../ManagerScope.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const GrowCardEntry = Schema.Struct({
  threadId: ThreadId,
  stage: Schema.NullOr(GrowStage),
  became: Schema.NullOr(Schema.String),
  lessons: Schema.Array(Schema.String),
  decision: Schema.NullOr(GrowDecision),
  parentThreadId: Schema.NullOr(ThreadId),
});

const GrowUpdateTool = Tool.make("grow_update", {
  description: [
    "Update a thread's Grow card. Grow on Home brings back what agents made, one at a time, for the owner to ship, change or let go.",
    "It reads the thread's previews, pull requests and status report, so to show up there well, call link_preview with a short label naming what it is.",
    "When the user tells you what they learned, liked or disliked, record it with `addLessons`, in their words.",
    "The `decision` (adopt is ship, shelve is let go, pivot) is the user's: record it only when they made it.",
    "`stage` and `became` are kept on the card for the manager. Defaults to this thread.",
  ].join(" "),
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Another thread's card. Defaults to this thread." }),
    ),
    stage: Schema.optional(
      Schema.NullOr(GrowStage).annotate({ description: "Null goes back to the derived stage." }),
    ),
    became: Schema.optional(
      Schema.String.annotate({ description: "One line on what the thread turned into." }),
    ),
    addLessons: Schema.optional(Schema.Array(Schema.String)),
    decision: Schema.optional(Schema.NullOr(GrowDecision)),
    parentThreadId: Schema.optional(
      Schema.NullOr(ThreadId).annotate({ description: "The thread this one branched from." }),
    ),
  }),
  success: GrowCardEntry,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ManagerScope.ManagerScope,
    Orchestrator.OrchestratorV2,
    GrowService.GrowService,
  ],
})
  .annotate(Tool.Title, "Update Grow card")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const GrowBoardTool = Tool.make("grow_board", {
  description:
    "Every card on the Grow board for the threads you can see: thread title, the stage the board shows (stored, else derived from the thread's previews, pull requests and run state), what it became, lessons and the regroup decision. Meant for the manager. A manager sees its profile's threads.",
  success: Schema.Struct({
    cards: Schema.Array(
      Schema.Struct({
        ...GrowCardEntry.fields,
        title: Schema.String,
        shownStage: GrowStage,
      }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ManagerScope.ManagerScope,
    Orchestrator.OrchestratorV2,
    GrowService.GrowService,
  ],
})
  .annotate(Tool.Title, "Read Grow board")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GrowRequestCloseTool = Tool.make("grow_request_close", {
  description: [
    "Answer a request the user sent this thread from Grow (Ship, for one), so Grow shows how it went instead of an open ask.",
    "`done` when it is landed (for Ship: merged and live); `blocked` with a one-line `note` on what stops it, so the user knows their move.",
    "Without `requestId` it answers the newest open request. A presentation request needs no call: writing the presentation (presentation_edit or presentation_set) answers it.",
  ].join(" "),
  parameters: Schema.Struct({
    requestId: Schema.optional(
      Schema.String.annotate({ description: "The requestId from the request's context." }),
    ),
    outcome: GrowRequestOutcome,
    note: Schema.optional(
      Schema.String.check(Schema.isMaxLength(THREAD_GROW_REQUEST_TEXT_MAX_CHARS)),
    ),
  }),
  success: Schema.Struct({ requestId: Schema.String, outcome: GrowRequestOutcome }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Orchestrator.OrchestratorV2,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Answer a Grow request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GrowToolkit = Toolkit.make(GrowUpdateTool, GrowBoardTool, GrowRequestCloseTool);
