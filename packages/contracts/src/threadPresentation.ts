import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/** Most pages a presentation holds; it is glanced at, not read through. */
export const THREAD_PRESENTATION_MAX_PAGES = 12;
/** Longest markdown a doc page keeps. */
export const THREAD_PRESENTATION_DOC_MAX_CHARS = 20_000;
/** Most versions a presentation remembers; older ones fall off. */
export const THREAD_PRESENTATION_MAX_VERSIONS = 30;

const Percent = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const PageTitle = Schema.String.check(Schema.isMaxLength(120));

/** Names a page across edits, so an agent changes it in place: `summary`, `after-shot`. */
export const PresentationPageId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/),
);

/**
 * What every page carries. Both are set by the server and optional only so presentations
 * from before versions still decode: `revision` is the version the page last changed in.
 */
const PageMeta = {
  id: Schema.optional(PresentationPageId),
  title: Schema.optional(PageTitle),
  revision: Schema.optional(Schema.Int),
};

/** A box drawn on an image page, in percent of the image so it survives scaling. */
export const PresentationMark = Schema.Struct({
  x: Percent,
  y: Percent,
  width: Percent,
  height: Percent,
  /** Two to four words saying what changed there. */
  label: Schema.String.check(Schema.isMaxLength(60)),
});
export type PresentationMark = typeof PresentationMark.Type;

/** Most questions a form page asks; it is a quick decision, not a survey. */
export const THREAD_PRESENTATION_FORM_MAX_FIELDS = 6;

/** One question on a form page: a pick among options, or a short written answer. */
export const PresentationField = Schema.Struct({
  /** Names the answer for the agent; unique within the page. */
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  /** Two to six options make it a pick; none make it a short text answer. */
  options: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(80))).check(Schema.isMaxLength(6)),
  ),
});
export type PresentationField = typeof PresentationField.Type;

/** Most blocks a widget page holds. */
export const THREAD_PRESENTATION_MAX_BLOCKS = 40;

/** A widget from the workspace pool by name, the props it is drawn with, and its width. */
export const PresentationWidgetBlock = Schema.Struct({
  widget: Schema.String.check(Schema.isPattern(/^[A-Z][A-Za-z0-9]{0,59}$/)),
  props: Schema.Record(Schema.String, Schema.Unknown),
  /** Half width sits beside the next half block on wide screens. */
  span: Schema.optional(Schema.Literals(["full", "half"])),
});
export type PresentationWidgetBlock = typeof PresentationWidgetBlock.Type;

/**
 * One page of a presentation. Files live in T3 storage: `image` and `file` are attachment
 * ids, and a doc's images are `attachment:<id>` links. A `form` asks the user to decide;
 * the answers come back to the thread as a message.
 */
export const PresentationPage = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("image"),
    ...PageMeta,
    image: Schema.String,
    marks: Schema.optional(Schema.Array(PresentationMark)),
  }),
  Schema.Struct({
    kind: Schema.Literal("doc"),
    ...PageMeta,
    markdown: Schema.String.check(Schema.isMaxLength(THREAD_PRESENTATION_DOC_MAX_CHARS)),
  }),
  Schema.Struct({
    kind: Schema.Literal("html"),
    ...PageMeta,
    file: Schema.String,
  }),
  /** A page of blocks from a workspace widget pool; kept so presentations that have one still load. */
  Schema.Struct({
    kind: Schema.Literal("widgets"),
    ...PageMeta,
    blocks: Schema.Array(PresentationWidgetBlock).check(
      Schema.isMaxLength(THREAD_PRESENTATION_MAX_BLOCKS),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("form"),
    ...PageMeta,
    fields: Schema.Array(PresentationField).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(THREAD_PRESENTATION_FORM_MAX_FIELDS),
    ),
  }),
]);
export type PresentationPage = typeof PresentationPage.Type;

/**
 * One version of a presentation: every edit during one run of the agent (one prompt) lands in
 * the same version, the next prompt starts a new one. A version that was moved past keeps its
 * pages in `snapshot`, a stored JSON file of them.
 */
export const PresentationVersion = Schema.Struct({
  version: Schema.Int,
  /** The run of the thread it belongs to, by id; empty for a presentation from before. */
  run: Schema.String,
  startedAt: IsoDateTime,
  snapshot: Schema.optional(Schema.String),
});
export type PresentationVersion = typeof PresentationVersion.Type;

/**
 * The thread's presentation: the idea in a glanceable form, a few pages of marked screenshots,
 * short docs, interactive pages and forms. It is a living artifact the agent edits along the way
 * (`presentation_edit`, `presentation_set`), versioned per prompt like commits; the right panel shows the
 * current pages first and steps back through earlier versions. An empty set removes it.
 */
export const ThreadPresentation = Schema.Struct({
  pages: Schema.Array(PresentationPage).check(Schema.isMaxLength(THREAD_PRESENTATION_MAX_PAGES)),
  updatedAt: IsoDateTime,
  /** Oldest first; the last one is the current version. Absent on presentations from before. */
  versions: Schema.optional(Schema.Array(PresentationVersion)),
});
export type ThreadPresentation = typeof ThreadPresentation.Type;
