import { McpCapabilityUnavailableError, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, Orchestrator.OrchestratorV2];

const PreviewUrl = TrimmedNonEmptyString.annotate({
  description:
    "The preview's http or https URL, for example http://my-branch.preview.example.org or http://localhost:5173.",
});

export const LinkPreviewInput = Schema.Struct({
  url: PreviewUrl,
  label: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Short name shown on the thread. Defaults to the first part of the host name.",
    }),
  ),
});
export type LinkPreviewInput = typeof LinkPreviewInput.Type;

export const UnlinkPreviewInput = Schema.Struct({ url: PreviewUrl });
export type UnlinkPreviewInput = typeof UnlinkPreviewInput.Type;

export class PreviewLinkUrlInvalidError extends Schema.TaggedError<PreviewLinkUrlInvalidError>()(
  "PreviewLinkUrlInvalidError",
  {},
) {
  override get message(): string {
    return "A preview link must be an http or https URL.";
  }
}

export class PreviewLinkThreadNotFoundError extends Schema.TaggedError<PreviewLinkThreadNotFoundError>()(
  "PreviewLinkThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class PreviewLinkUpdateFailedError extends Schema.TaggedError<PreviewLinkUpdateFailedError>()(
  "PreviewLinkUpdateFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not update the thread's preview links.";
  }
}

export const PreviewLinkToolError = Schema.Union([
  McpCapabilityUnavailableError,
  PreviewLinkUrlInvalidError,
  PreviewLinkThreadNotFoundError,
  PreviewLinkUpdateFailedError,
]);
export type PreviewLinkToolError = typeof PreviewLinkToolError.Type;

export const LinkPreviewResult = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL as stored on the thread." }),
  alreadyLinked: Schema.Boolean.annotate({
    description: "True when this preview was linked to the thread before the call.",
  }),
});
export type LinkPreviewResult = typeof LinkPreviewResult.Type;

export const UnlinkPreviewResult = Schema.Struct({
  url: Schema.String,
  wasLinked: Schema.Boolean.annotate({
    description: "False when the preview was not linked to this thread to begin with.",
  }),
});
export type UnlinkPreviewResult = typeof UnlinkPreviewResult.Type;

const LinkPreviewTool = Tool.make("link_preview", {
  description:
    "Show a preview of your work on this thread: a dev server or deployed preview URL the user can open. Call it when you start a preview or hand one to the user. The thread keeps the ten newest previews. Linking the same URL again is safe; passing a new label renames it.",
  parameters: LinkPreviewInput,
  success: LinkPreviewResult,
  failure: PreviewLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link preview to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkPreviewTool = Tool.make("unlink_preview", {
  description:
    "Remove a preview link from this thread, for example after stopping that dev server for good. Unlinking a URL that is not linked succeeds with wasLinked=false.",
  parameters: UnlinkPreviewInput,
  success: UnlinkPreviewResult,
  failure: PreviewLinkToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink preview from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PreviewLinksToolkit = Toolkit.make(LinkPreviewTool, UnlinkPreviewTool);
