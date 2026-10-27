import type {
  PresentationField,
  PresentationMark,
  PresentationPage,
  ThreadPresentation,
} from "@t3tools/contracts";

/** One page of a thread's presentation, ready to render. */
export type Slide = SlideBody & {
  /** Changed in the version on screen, so the strip can point at what is new. */
  readonly changed?: boolean;
};

type SlideBody =
  | {
      readonly kind: "image";
      readonly key: string;
      readonly name: string;
      readonly src: string;
      readonly marks: ReadonlyArray<PresentationMark>;
    }
  | { readonly kind: "doc"; readonly key: string; readonly name: string; readonly markdown: string }
  | { readonly kind: "html"; readonly key: string; readonly name: string; readonly src: string }
  | {
      readonly kind: "form";
      readonly key: string;
      readonly name: string;
      readonly fields: ReadonlyArray<PresentationField>;
      /** The id its answers are sent under, so the page knows it was answered. */
      readonly requestId: string;
    };

/** A markdown link or image whose target is a stored file. */
export const ATTACHMENT_LINK = /\]\(<?attachment:([\w-]+)>?\)/g;

/**
 * Pages to slides, given the URLs of the files they point at in the order `useSlides` asks for
 * them (null while loading). A page whose file has no URL yet is left out until it has one.
 */
export function buildSlides(
  pages: ThreadPresentation["pages"] | undefined,
  urls: ReadonlyArray<string | null>,
  presentationAt?: string,
  /** The version on screen; its pages carry the revision they last changed in. */
  version?: number,
): ReadonlyArray<Slide> {
  if (pages === undefined) return [];
  let at = 0;
  const next = () => urls[at++] ?? null;
  return pages.flatMap((page, index): Slide[] =>
    pageSlide(page, index, next, presentationAt).map((slide) =>
      // The first version is all new; marking every page of it would say nothing.
      version !== undefined && version > 1 && page.revision === version
        ? { ...slide, changed: true }
        : slide,
    ),
  );
}

function pageSlide(
  page: PresentationPage,
  index: number,
  next: () => string | null,
  presentationAt: string | undefined,
): SlideBody[] {
  const key = `page:${page.id ?? index}`;
  switch (page.kind) {
    case "image": {
      const src = next();
      const name = page.title ?? `Page ${index + 1}`;
      return src ? [{ kind: "image", key, name, src, marks: page.marks ?? [] }] : [];
    }
    case "html": {
      const src = next();
      return src ? [{ kind: "html", key, name: page.title ?? "Interactive page", src }] : [];
    }
    case "doc": {
      // Images stored for the page show through their asset URLs; one still loading
      // stays a plain link until it resolves.
      const markdown = page.markdown.replace(ATTACHMENT_LINK, (whole) => {
        const url = next();
        return url ? `](${url})` : whole;
      });
      return [{ kind: "doc", key, name: page.title ?? docTitle(page.markdown), markdown }];
    }
    // Widget pages need the retired Grow widget pool; older presentations may still have one.
    case "widgets":
      return [];
    case "form":
      return [
        {
          kind: "form",
          key,
          name: page.title ?? "Your call",
          fields: page.fields,
          requestId: formRequestId(page, index, presentationAt),
        },
      ];
  }
}

function docTitle(markdown: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : "Page";
}

/**
 * A form page's request id: the page and the version it last changed in, so editing other pages
 * keeps it answered and changing its questions asks anew. Pages from before ids go by the time.
 */
function formRequestId(
  page: PresentationPage,
  index: number,
  presentationAt: string | undefined,
): string {
  if (page.id !== undefined) return `form-${page.id}-${page.revision ?? 1}`;
  return `form-${(presentationAt ?? "").replace(/\D/g, "")}-${index}`;
}

/** How a question opens its answer line: one that already ends in ? or : takes no extra colon. */
function answerPrefix(field: PresentationField): string {
  return /[?:]$/.test(field.label) ? field.label : `${field.label}:`;
}

/**
 * A form's answers as the message the agent reads: one `question: answer` per line. A pick must
 * be made; a written answer may be left empty, and then its line is left out.
 */
export function formAnswerText(
  fields: ReadonlyArray<PresentationField>,
  answers: Readonly<Record<string, string>>,
): string {
  return fields
    .flatMap((field) => {
      const answer = (answers[field.id] ?? "").trim();
      return answer === "" ? [] : [`${answerPrefix(field)} ${answer}`];
    })
    .join("\n");
}

/** Whether every pick on a form is made and something is said, so its answers can be sent. */
export function formComplete(
  fields: ReadonlyArray<PresentationField>,
  answers: Readonly<Record<string, string>>,
): boolean {
  const said = (field: PresentationField) => (answers[field.id] ?? "").trim() !== "";
  return fields.every((field) => !field.options || said(field)) && fields.some(said);
}

/** The answers a sent form held, read back from its message, so changing one keeps the rest. */
export function formAnswersFromText(
  fields: ReadonlyArray<PresentationField>,
  text: string,
): Record<string, string> {
  const lines = text.split("\n");
  const answers: Record<string, string> = {};
  for (const field of fields) {
    const prefix = `${answerPrefix(field)} `;
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (line !== undefined) answers[field.id] = line.slice(prefix.length);
  }
  return answers;
}
