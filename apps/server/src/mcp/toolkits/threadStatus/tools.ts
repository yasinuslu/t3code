import {
  OrchestratorMcpFailure,
  THREAD_STATUS_REPORT_MAX_CHARS,
  ThreadId,
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
    "Write it like a short final report in markdown: a first paragraph saying where things stand (working, needs the user, done, or blocked on what), a `## What changed` list of up to 3 items, the screenshots that show the change, and a `## Needs you` section with the decision or action the user owes, if any.",
    "Embed screenshots as markdown images with absolute paths on this machine, e.g. `![Stage, before and after](/abs/path/stage.png)` (png, jpg, gif, webp). They are copied into the app's storage, so they survive the worktree or /tmp being removed.",
    "Call it at milestones and once more with your final report.",
  ].join(" "),
  parameters: Schema.Struct({
    report: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(THREAD_STATUS_REPORT_MAX_CHARS),
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
