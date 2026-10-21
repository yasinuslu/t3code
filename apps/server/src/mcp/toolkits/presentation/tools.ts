import {
  OrchestratorMcpFailure,
  PresentationField,
  PresentationMark,
  THREAD_PRESENTATION_DOC_MAX_CHARS,
  THREAD_PRESENTATION_FORM_MAX_FIELDS,
  THREAD_PRESENTATION_MAX_PAGES,
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

const Title = Schema.String.check(Schema.isMaxLength(120)).annotate({
  description: "A few words naming the page.",
});

const PageInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("image"),
    title: Schema.optional(Title),
    image: Schema.String.annotate({
      description:
        "Absolute path to a png, jpg, gif or webp on this machine, or an `attachment:<id>` from an earlier presentation_set.",
    }),
    marks: Schema.optional(
      Schema.Array(PresentationMark).annotate({
        description:
          "Boxes drawn over the image on what changed, in percent of the image (x, y, width, height from the top left), each with a 2-4 word label.",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("doc"),
    title: Schema.optional(Title),
    markdown: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(THREAD_PRESENTATION_DOC_MAX_CHARS),
    ).annotate({
      description:
        "A short page in markdown: headings, lists, tables, code, images by absolute path. Glanceable, not a report.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("html"),
    title: Schema.optional(Title),
    html: Schema.optional(
      Schema.String.annotate({ description: "A whole self-contained HTML page, inline." }),
    ),
    path: Schema.optional(
      Schema.String.annotate({
        description: "Or an absolute path to a self-contained .html file on this machine.",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("form"),
    title: Schema.optional(Title),
    fields: Schema.Array(PresentationField)
      .check(Schema.isMinLength(1), Schema.isMaxLength(THREAD_PRESENTATION_FORM_MAX_FIELDS))
      .annotate({
        description:
          "The questions, each with an id and a label; give 2-6 `options` for a pick, none for a short written answer.",
      }),
  }),
]);

const PresentationSetTool = Tool.make("presentation_set", {
  description: [
    "Set this thread's presentation: the idea in a form the user grasps at a glance, shown first in Grow beside the conversation and the live preview. Each call replaces the whole presentation; an empty `pages` removes it.",
    "Pages, in the order they should be seen: `image` (a screenshot of the result, with `marks` boxing what changed; a short GIF for motion), `doc` (a short markdown page: the decision, a before/after table, a diagram), `html` (a self-contained interactive page: a mock to click through, a chart, a small demo; it runs sandboxed, with no access to the app), and `form` (a few questions for a decision only the user can make; the answers come back to this thread as a message).",
    "Keep it minimal: one to four pages usually. Files are copied into the app's storage, so they outlive the worktree. Set it when there is something to see, and again when it changes.",
  ].join(" "),
  parameters: Schema.Struct({
    pages: Schema.Array(PageInput).check(Schema.isMaxLength(THREAD_PRESENTATION_MAX_PAGES)),
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Another thread to update. Defaults to this thread." }),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    pages: Schema.Number,
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
  .annotate(Tool.Title, "Set the thread's presentation")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PresentationToolkit = Toolkit.make(PresentationSetTool);
