import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";

/** Most pages a presentation holds; it is glanced at, not read through. */
export const THREAD_PRESENTATION_MAX_PAGES = 12;
/** Longest markdown a doc page keeps. */
export const THREAD_PRESENTATION_DOC_MAX_CHARS = 20_000;

const Percent = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const PageTitle = Schema.String.check(Schema.isMaxLength(120));

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

/**
 * One page of a presentation. Files live in T3 storage: `image` and `file` are attachment
 * ids, and a doc's images are `attachment:<id>` links. A `form` asks the user to decide;
 * the answers come back to the thread as a message.
 */
export const PresentationPage = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("image"),
    title: Schema.optional(PageTitle),
    image: Schema.String,
    marks: Schema.optional(Schema.Array(PresentationMark)),
  }),
  Schema.Struct({
    kind: Schema.Literal("doc"),
    title: Schema.optional(PageTitle),
    markdown: Schema.String.check(Schema.isMaxLength(THREAD_PRESENTATION_DOC_MAX_CHARS)),
  }),
  Schema.Struct({
    kind: Schema.Literal("html"),
    title: Schema.optional(PageTitle),
    file: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("form"),
    title: Schema.optional(PageTitle),
    fields: Schema.Array(PresentationField).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(THREAD_PRESENTATION_FORM_MAX_FIELDS),
    ),
  }),
]);
export type PresentationPage = typeof PresentationPage.Type;

/**
 * The thread's presentation (`presentation_set`): the idea in a glanceable form, a few pages
 * of marked screenshots, short docs and interactive pages. Grow shows it first; each set
 * replaces the last, and an empty one removes it.
 */
export const ThreadPresentation = Schema.Struct({
  pages: Schema.Array(PresentationPage).check(Schema.isMaxLength(THREAD_PRESENTATION_MAX_PAGES)),
  updatedAt: IsoDateTime,
});
export type ThreadPresentation = typeof ThreadPresentation.Type;
