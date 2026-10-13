import { GrowDecision, GrowStage, OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

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
    "Move a thread's card on the Grow board on Home, which follows the owner's loop: idea, exploring, play, regroup, building on main, in use.",
    "When your prototype is something the user can click, call link_preview with its URL and grow_update with stage `play` and a one-line `became`.",
    "When the user tells you what they learned, liked or disliked, record it with `addLessons`, in their words.",
    "The regroup decision (`decision`: adopt, pivot or shelve) is the user's: record it only when they made it.",
    "Without a stage the board derives one from the thread. Defaults to this thread.",
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

export const GrowToolkit = Toolkit.make(GrowUpdateTool, GrowBoardTool);
