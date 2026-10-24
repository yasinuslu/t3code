import type { WorkOverview, WorkThreadInput } from "@t3tools/client-runtime/state/work-overview";

/** What a card shows from a thread's latest report (its last answer). */
export interface ThreadReportDigest {
  /** The report's first paragraph as one plain line. */
  readonly summary: string | null;
  /** The first list of the report, or of its "what changed" / "done" section. */
  readonly bullets: ReadonlyArray<string>;
  /** Dev servers and previews the report points at (URLs with a port). */
  readonly tryUrls: ReadonlyArray<string>;
  /** Screenshots the report embeds or links: absolute paths, or ones stored with the thread. */
  readonly screenshots: ReadonlyArray<ReportScreenshot>;
  /** What the report asks of the user, from its questions section. */
  readonly questions: ReadonlyArray<string>;
}

/** A local file on the thread's machine, or a copy `thread_status_update` stored (`attachment:<id>`). */
export type ReportScreenshot =
  | { readonly path: string; readonly alt: string }
  | { readonly attachmentId: string; readonly alt: string };

const ATTACHMENT_REF = /^attachment:([\w-]+)$/;
const MAX_BULLETS = 3;
const MAX_TRY_URLS = 2;
const MAX_SCREENSHOTS = 6;
const MAX_QUESTIONS = 2;
const SUMMARY_MAX_CHARS = 220;
const BULLET_MAX_CHARS = 160;

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
const BULLETS_HEADING = /^(what changed|changes|done|what's done|summary)\b/i;
const QUESTIONS_HEADING = /\b(open questions?|questions?|decisions?|needs you|blocked)\b/i;

/** Markdown inline syntax reduced to its visible text. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_\s][^*_]*)[*_](?=$|[^*\w])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > max * 0.5 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
}

interface Section {
  readonly heading: string | null;
  readonly lines: ReadonlyArray<string>;
}

function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      sections.push(current);
      current = { heading: plainInline(heading[1] ?? ""), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

const BULLET = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Top-level list items of a section, each with its continuation lines joined. */
function bulletsOf(lines: ReadonlyArray<string>): string[] {
  const items: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const match = BULLET.exec(line);
    if (match && !/^\s{2,}/.test(line)) {
      items.push(match[1] ?? "");
      collecting = true;
    } else if (collecting && /^\s+\S/.test(line) && !BULLET.test(line.trim())) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      if (items.length > 0) collecting = false;
    } else {
      collecting = false;
    }
  }
  return items.map((item) => plainInline(item)).filter((item) => item.length > 0);
}

function firstParagraph(lines: ReadonlyArray<string>): string | null {
  const paragraph: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    if (BULLET.test(line) || /^(>|\||!\[|<)/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  const text = plainInline(paragraph.join(" "));
  return text.length > 0 ? text : null;
}

/** The prop of a component's JSON that says what it is about, in the order worth showing. */
const ELEMENT_TEXT_KEYS = ["outcome", "title", "question", "prompt", "text", "summary"] as const;

/**
 * A reply or report with its `<t3-*>` components reduced to plain text, for the places that show
 * text and not components (cards, rows, one-line summaries): a component's headline or title
 * stays as a line, and one with nothing to say as text (a chart, a table) is dropped, so raw
 * component JSON never reaches a summary.
 */
export function elementsToPlainText(text: string): string {
  return text
    .replace(/<(t3-[a-z0-9-]+)\b[^>]*>([\s\S]*?)<\/\1>/g, (_whole, _tag: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed.startsWith("{")) return trimmed;
      try {
        const props: unknown = JSON.parse(trimmed);
        if (typeof props !== "object" || props === null) return "";
        for (const key of ELEMENT_TEXT_KEYS) {
          const value = (props as Record<string, unknown>)[key];
          if (typeof value === "string" && value.trim() !== "") return `\n\n${value.trim()}\n\n`;
        }
      } catch {
        // A half-written body is not text worth showing.
      }
      return "";
    })
    .replace(/<\/?t3-[^>\n]*>/g, "");
}

/** Reads a final report the way the HTML reports agents make lay it out. */
export function digestThreadReport(source: string | null | undefined): ThreadReportDigest {
  if (!source) return { summary: null, bullets: [], tryUrls: [], screenshots: [], questions: [] };
  const text = elementsToPlainText(source);
  const sections = sectionsOf(text);
  const allLines = sections.flatMap((section) => section.lines);
  // Links and images count only in prose, not in code blocks.
  const prose = allLines.join("\n");

  const summary = firstParagraph(sections[0]?.lines ?? []) ?? firstParagraph(allLines);

  const bulletSection =
    sections.find((section) => section.heading && BULLETS_HEADING.test(section.heading)) ??
    sections.find(
      (section) =>
        !(section.heading && QUESTIONS_HEADING.test(section.heading)) &&
        bulletsOf(section.lines).length > 0,
    );
  const bullets = (bulletSection ? bulletsOf(bulletSection.lines) : [])
    .slice(0, MAX_BULLETS)
    .map((bullet) => clip(bullet, BULLET_MAX_CHARS));

  const questionSection = sections.find(
    (section) => section.heading && QUESTIONS_HEADING.test(section.heading),
  );
  const questions = questionSection
    ? (bulletsOf(questionSection.lines).length > 0
        ? bulletsOf(questionSection.lines)
        : [firstParagraph(questionSection.lines) ?? ""]
      )
        .filter((question) => question.length > 0)
        .slice(0, MAX_QUESTIONS)
        .map((question) => clip(question, BULLET_MAX_CHARS))
    : [];

  const tryUrls: string[] = [];
  for (const match of prose.matchAll(/https?:\/\/[^\s)<>\]"'`]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.port === "" || /(^|\.)github\.com$/.test(parsed.hostname)) continue;
    if (/\/pair\b|[?&]token=/.test(url)) continue;
    const origin = `${parsed.protocol}//${parsed.host}/`;
    if (!tryUrls.includes(origin)) tryUrls.push(origin);
    if (tryUrls.length === MAX_TRY_URLS) break;
  }

  const screenshots: ReportScreenshot[] = [];
  const seen = new Set<string>();
  for (const match of prose.matchAll(/(!?)\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g)) {
    const path = decodeURI(match[3] ?? "");
    const attachmentId = ATTACHMENT_REF.exec(path)?.[1];
    if (!attachmentId && (!path.startsWith("/") || !IMAGE_EXTENSION.test(path))) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const alt = plainInline(match[2] ?? "");
    screenshots.push(
      attachmentId
        ? { attachmentId, alt: alt || "Screenshot" }
        : { path, alt: alt || (path.split("/").pop() ?? "") },
    );
    if (screenshots.length === MAX_SCREENSHOTS) break;
  }

  return {
    summary: summary ? clip(summary, SUMMARY_MAX_CHARS) : null,
    bullets,
    tryUrls,
    screenshots,
    questions,
  };
}
