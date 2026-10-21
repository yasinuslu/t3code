import {
  OrchestratorMcpFailure,
  PresentationField,
  PresentationMark,
  PresentationPage,
  PresentationPageId,
  PresentationVersion,
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

const PageId = PresentationPageId.annotate({
  description:
    "Names the page so later edits change it in place: lowercase words joined by dashes, e.g. `summary` or `after-shot`. Given by the server when left out.",
});

const PageInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("image"),
    id: Schema.optional(PageId),
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
    id: Schema.optional(PageId),
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
    id: Schema.optional(PageId),
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
    id: Schema.optional(PageId),
    title: Schema.optional(Title),
    fields: Schema.Array(PresentationField)
      .check(Schema.isMinLength(1), Schema.isMaxLength(THREAD_PRESENTATION_FORM_MAX_FIELDS))
      .annotate({
        description:
          "The questions, each with an id and a label; give 2-6 `options` for a pick, none for a short written answer.",
      }),
  }),
]);

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
  ServerConfig.ServerConfig,
  FileSystem.FileSystem,
  Path.Path,
  Crypto.Crypto,
];

const OtherThread = Schema.optional(
  ThreadId.annotate({ description: "Another thread's presentation. Defaults to this thread." }),
);

const Written = Schema.Struct({
  threadId: ThreadId,
  /** The version these edits landed in. */
  version: Schema.Number,
  pages: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.optional(Schema.String) })),
});

const LIVING = [
  "The presentation is this thread's living artifact: the idea in a form the user grasps at a glance, shown first in Grow beside the conversation and the live preview. It is not a final report. Create it early, as soon as there is an idea to show, and edit it as the work changes, the way you edit code.",
  "It is versioned per prompt like commits: every write while you answer one message lands in one version, the next message starts the next, and the user can step back through earlier versions.",
].join(" ");

const PAGES = [
  "Pages, in the order they should be seen: `image` (a screenshot of the result, with `marks` boxing what changed; a short GIF for motion), `doc` (a short markdown page: the decision, a before/after table, a diagram), `html` (a self-contained interactive page: a mock to click through, a chart, a small demo; it runs sandboxed, with no access to the app), and `form` (a few questions for a decision only the user can make; the answers come back to this thread as a message).",
  "Give pages an `id` so you can edit them later. Keep it minimal: one to four pages usually. Files are copied into the app's storage, so they outlive the worktree.",
].join(" ");

const PresentationSetTool = Tool.make("presentation_set", {
  description: [
    LIVING,
    "This call writes the whole page list; an empty `pages` removes the presentation. To change one page, use presentation_edit.",
    PAGES,
  ].join(" "),
  parameters: Schema.Struct({
    pages: Schema.Array(PageInput).check(Schema.isMaxLength(THREAD_PRESENTATION_MAX_PAGES)),
    threadId: OtherThread,
  }),
  success: Written,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Set the thread's presentation")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PresentationEditTool = Tool.make("presentation_edit", {
  description: [
    LIVING,
    "Edits pages by id and leaves the rest as they are: `put` replaces the page with the same id in place or adds a new one at the end, `remove` drops pages, `order` lists ids in the order they should be seen. Read the current pages and their ids with presentation_get. Starts the presentation when there is none.",
    PAGES,
  ].join(" "),
  parameters: Schema.Struct({
    put: Schema.optional(
      Schema.Array(PageInput).check(Schema.isMaxLength(THREAD_PRESENTATION_MAX_PAGES)),
    ),
    remove: Schema.optional(Schema.Array(PresentationPageId)),
    order: Schema.optional(Schema.Array(PresentationPageId)),
    threadId: OtherThread,
  }),
  success: Written,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Edit the thread's presentation")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PresentationGetTool = Tool.make("presentation_get", {
  description:
    "Read this thread's presentation the way you read code before changing it: its pages with ids, each page's `revision` (the version it last changed in), and the list of versions. Pass `version` to read an earlier version's pages. Files appear as `attachment:<id>`, which presentation_set and presentation_edit accept back as they are.",
  parameters: Schema.Struct({
    version: Schema.optional(Schema.Int.annotate({ description: "An earlier version to read." })),
    threadId: OtherThread,
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    /** The version shown, or absent when the thread has no presentation. */
    version: Schema.optional(Schema.Number),
    pages: Schema.Array(PresentationPage),
    versions: Schema.Array(PresentationVersion),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read the thread's presentation")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PresentationToolkit = Toolkit.make(
  PresentationSetTool,
  PresentationEditTool,
  PresentationGetTool,
);
