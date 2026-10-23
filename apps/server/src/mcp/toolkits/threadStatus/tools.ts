import {
  OrchestratorMcpFailure,
  THREAD_STATUS_REPORT_MAX_CHARS,
  ThreadId,
  ThreadStatusOutcome,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as ServerConfig from "../../../config.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ThreadStatusUpdateTool = Tool.make("thread_status_update", {
  description: [
    "Set the status card shown at the top of the thread and on Home. Each call replaces the last; the card prefers it over your final answer for the run it was set in.",
    "Write it like a short final report in markdown: a first paragraph saying where things stand (working, needs the user, done, or blocked on what), a `## What changed` list of up to 3 items, the proof image (required in the final report: the result with the change marked, a short GIF for motion, or an image of the evidence for work with nothing on screen), and a `## Needs you` section with the decision or action the user owes, if any.",
    "Embed screenshots as markdown images with absolute paths on this machine, e.g. `![Stage, before and after](/abs/path/stage.png)` (png, jpg, gif, webp). They are copied into the app's storage, so they survive the worktree or /tmp being removed.",
    "Call it at milestones and once more with your final report.",
    "With the final report pass outcome: 'needs-you' when the user owes a decision, an answer or a merge OK (the thread waits at the top of their list and never settles on its own); 'done' when the result has landed (PR merged and deployed, report delivered and linked, card written) and nothing is needed (the thread settles itself when the turn ends; a new message wakes it). Omit it at milestones.",
  ].join(" "),
  parameters: Schema.Struct({
    report: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(THREAD_STATUS_REPORT_MAX_CHARS),
    ),
    outcome: Schema.optional(
      ThreadStatusOutcome.annotate({
        description:
          "'needs-you': the user owes a move. 'done': the result landed, nothing needed; the thread settles. Omit while working.",
      }),
    ),
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Another thread to update. Defaults to this thread." }),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    storedImages: Schema.Number.annotate({
      description: "How many screenshots were copied into the app's storage.",
    }),
    warning: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Orchestrator.OrchestratorV2,
    ServerConfig.ServerConfig,
    FileSystem.FileSystem,
    Path.Path,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Update thread status card")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadStatusToolkit = Toolkit.make(ThreadStatusUpdateTool);
