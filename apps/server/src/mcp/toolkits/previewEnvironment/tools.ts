import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Crypto from "effect/Crypto";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PreviewEnvironmentService from "../../../previewEnvironment/PreviewEnvironmentService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const parameters = Schema.Struct({
  threadId: Schema.optional(
    ThreadId.annotate({ description: "Another thread to act on. Defaults to this thread." }),
  ),
});

const success = Schema.Struct({
  threadId: ThreadId,
  status: Schema.Literals(["starting", "stopping"]),
});

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
  PreviewEnvironmentService.PreviewEnvironmentService,
  Crypto.Crypto,
];

const PreviewEnvironmentUpTool = Tool.make("preview_environment_up", {
  description:
    "Start this thread's preview environment with the project's t3.json `preview.up` command. It runs in the background: the URL it prints is linked to the thread and Grow shows it as Live. Poll nothing, the thread's status updates by itself. Use this instead of starting servers by hand.",
  parameters,
  success,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start the preview environment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const PreviewEnvironmentDownTool = Tool.make("preview_environment_down", {
  description:
    "Stop this thread's preview environment with the project's t3.json `preview.down` command and unlink its preview. It runs in the background and the thread's status updates by itself.",
  parameters,
  success,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop the preview environment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PreviewEnvironmentToolkit = Toolkit.make(
  PreviewEnvironmentUpTool,
  PreviewEnvironmentDownTool,
);
