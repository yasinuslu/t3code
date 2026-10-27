import {
  type AssetResource,
  type EnvironmentId,
  type ScopedThreadRef,
  PresentationPage,
  type PresentationMark,
  type ThreadPresentation,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  FileTextIcon,
  ListChecksIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  ATTACHMENT_LINK,
  type Slide,
  buildSlides,
  formAnswersFromText,
  formAnswerText,
  formComplete,
} from "./presentation.logic";

const decodePages = Schema.decodeUnknownOption(Schema.Array(PresentationPage));

/** The presentation version on screen, and the way to step through the others. */
export interface PresentationVersions {
  /** The version on screen; absent for a presentation from before versions. */
  readonly version: number | undefined;
  readonly latest: number | undefined;
  /** Versions whose pages can be shown, oldest first. */
  readonly available: ReadonlyArray<number>;
  readonly startedAt: string | undefined;
  /** Showing an earlier version, so its forms cannot be answered. */
  readonly past: boolean;
  readonly loading: boolean;
  readonly pick: (version: number | null) => void;
}

/**
 * Which version of a thread's presentation is on screen: the current one, unless the user
 * stepped back. An earlier version's pages are a stored JSON file, fetched when picked.
 */
export function usePresentationVersion(
  environmentId: EnvironmentId,
  threadKey: string,
  presentation: ThreadPresentation | null,
): { readonly presentation: ThreadPresentation | null; readonly versions: PresentationVersions } {
  const entries = presentation?.versions ?? [];
  const latest = entries.at(-1)?.version;
  const [picked, setPicked] = useState<{ readonly key: string; readonly version: number } | null>(
    null,
  );
  const version = picked?.key === threadKey ? picked.version : latest;
  const entry = entries.find((candidate) => candidate.version === version);
  const snapshot = version === latest ? undefined : entry?.snapshot;
  const resources: AssetResource[] =
    snapshot === undefined
      ? []
      : [{ _tag: "attachment", attachmentId: snapshot, fileName: "pages.json" }];
  const url = useAssetUrls(environmentId, resources)[0] ?? null;
  const [loaded, setLoaded] = useState<{
    readonly snapshot: string;
    readonly pages: ThreadPresentation["pages"];
  } | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- fetches an older version's pages
  useEffect(() => {
    if (url === null || snapshot === undefined) return;
    let live = true;
    void fetch(url)
      .then((response) => response.json())
      .then((json: unknown) => {
        const pages = decodePages(json);
        if (live && pages._tag === "Some") setLoaded({ snapshot, pages: pages.value });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [snapshot, url]);
  const past = snapshot !== undefined;
  const shown =
    past && loaded?.snapshot === snapshot && presentation !== null
      ? { ...presentation, pages: loaded.pages }
      : presentation;
  return {
    presentation: shown,
    versions: {
      version,
      latest,
      available: entries.flatMap((candidate) =>
        candidate.version === latest || candidate.snapshot !== undefined ? [candidate.version] : [],
      ),
      startedAt: entry?.startedAt,
      past,
      loading: past && shown === presentation,
      pick: (next) =>
        setPicked(next === null || next === latest ? null : { key: threadKey, version: next }),
    },
  };
}

/** Every file the pages point at, in page order, resolved in one batch. */
function pageResources(pages: ThreadPresentation["pages"] | undefined): AssetResource[] {
  const list: AssetResource[] = [];
  for (const page of pages ?? []) {
    if (page.kind === "image") list.push({ _tag: "attachment", attachmentId: page.image });
    if (page.kind === "html") {
      list.push({
        _tag: "attachment",
        attachmentId: page.file,
        fileName: "page.html",
        mimeType: "text/html",
        disposition: "inline",
      });
    }
    if (page.kind === "doc") {
      for (const match of page.markdown.matchAll(ATTACHMENT_LINK)) {
        list.push({ _tag: "attachment", attachmentId: match[1] ?? "" });
      }
    }
  }
  return list;
}

/** The presentation's pages as slides, with every file they point at resolved to a URL. */
export function useSlides(
  environmentId: EnvironmentId,
  presentation: ThreadPresentation | null,
  version?: number,
): ReadonlyArray<Slide> {
  const pages = presentation?.pages;
  const urls = useAssetUrls(environmentId, pageResources(pages));
  return buildSlides(pages, urls, presentation?.updatedAt, version);
}

/** A slide, filling the stage. An image opens larger on click; a page scrolls or runs. */
export function SlideView(props: {
  readonly slide: Slide;
  readonly threadRef: ScopedThreadRef;
  readonly onZoom: () => void;
  /** Answers sent from this panel, by form request id. */
  readonly answers: Readonly<Record<string, string>>;
  readonly onAnswer: (requestId: string, text: string) => void;
  /** An earlier version: a record, so its forms and components take no answers. */
  readonly readOnly: boolean;
}) {
  const { slide } = props;
  switch (slide.kind) {
    case "image":
      return (
        <button
          type="button"
          className="flex min-h-0 flex-1 cursor-zoom-in items-center justify-center p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open ${slide.name}`}
          onClick={props.onZoom}
        >
          <MarkedImage slide={slide} className="size-full" />
        </button>
      );
    case "doc":
      return (
        <ScrollArea className="min-h-0 flex-1">
          {/* A component on the page answers on the thread, like one in the conversation. */}
          <div inert={props.readOnly} className={props.readOnly ? "opacity-70" : undefined}>
            <ChatMarkdown
              key={slide.key}
              text={slide.markdown}
              cwd={undefined}
              environmentId={props.threadRef.environmentId}
              threadRef={props.threadRef}
              className="px-4 py-4"
            />
          </div>
        </ScrollArea>
      );
    case "html":
      return (
        <div className="flex min-h-80 flex-1 flex-col">
          <BrowserDocumentFrame src={slide.src} title={slide.name} pdf={false} />
        </div>
      );
    case "form":
      return (
        <ScrollArea className="min-h-0 flex-1">
          <FormSlide
            key={slide.requestId}
            slide={slide}
            answered={props.answers[slide.requestId]}
            readOnly={props.readOnly}
            onAnswer={(text) => props.onAnswer(slide.requestId, text)}
          />
        </ScrollArea>
      );
  }
}

/** A form page: the agent's questions, answered here and sent to the thread as a message. */
function FormSlide(props: {
  readonly slide: Extract<Slide, { kind: "form" }>;
  readonly answered: string | undefined;
  readonly onAnswer: (text: string) => void;
  readonly readOnly: boolean;
}) {
  const { slide, answered } = props;
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState(false);
  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));
  const complete = formComplete(slide.fields, answers);
  const edit = () => {
    setAnswers(formAnswersFromText(slide.fields, answered ?? ""));
    setEditing(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    props.onAnswer(formAnswerText(slide.fields, answers));
    setEditing(false);
  };
  if (answered !== undefined && !editing && !props.readOnly) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-5">
        <p className="flex items-center gap-1.5 font-medium text-sm">
          <CheckIcon className="size-4 text-success" />
          Sent
        </p>
        <p className="whitespace-pre-line text-muted-foreground text-sm">{answered}</p>
        <Button variant="outline" size="sm" className="self-start" onClick={edit}>
          Change answers
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-5 px-6 py-5">
      {slide.fields.map((field) => (
        <fieldset key={field.id} className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-sm">{field.label}</legend>
          {field.options ? (
            <div className="flex flex-wrap gap-2">
              {field.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={answers[field.id] === option ? "default" : "outline"}
                  aria-pressed={answers[field.id] === option}
                  disabled={props.readOnly}
                  onClick={() => set(field.id, option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : (
            <Input
              aria-label={field.label}
              placeholder="Optional"
              disabled={props.readOnly}
              value={answers[field.id] ?? ""}
              onChange={(event) => set(field.id, event.currentTarget.value)}
            />
          )}
        </fieldset>
      ))}
      {props.readOnly ? (
        <p className="text-muted-foreground text-xs">
          From an earlier version; answer it on the latest.
        </p>
      ) : null}
      <div className={cn("flex gap-2", props.readOnly && "hidden")}>
        <Button type="submit" disabled={!complete}>
          Send answers
        </Button>
        {answered !== undefined && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** An image with its marks drawn over it. */
function MarkedImage(props: {
  readonly slide: Extract<Slide, { kind: "image" }>;
  readonly className: string;
}) {
  const { slide } = props;
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  const image = (
    <img
      src={slide.src}
      alt={slide.name}
      className={cn("block rounded-md object-contain", props.className)}
      onLoad={(event) =>
        setSize({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
    />
  );
  if (slide.marks.length === 0) return image;
  return (
    // Shrinks to the image, or fills the stage with it; the overlay covers the same box.
    <span className={cn("relative inline-block", props.className)}>
      {image}
      {size === null ? null : <MarkOverlay marks={slide.marks} size={size} />}
    </span>
  );
}

/**
 * A slide's marks as an SVG in the image's own pixel space, laid over it; letterboxes exactly
 * like `object-contain`, so a box stays on its spot at any size or zoom.
 */
export function MarkOverlay(props: {
  readonly marks: ReadonlyArray<PresentationMark>;
  readonly size: { readonly width: number; readonly height: number };
}) {
  const { size } = props;
  // Strokes and labels keep one on-screen size however small or zoomed the image shows.
  const [scale, setScale] = useState(1);
  const ref = useRef<SVGSVGElement>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- follows the rendered size of the svg
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    return observeResize(svg, ([entry]) => {
      if (!entry) return;
      const fit = Math.min(
        entry.contentRect.width / size.width,
        entry.contentRect.height / size.height,
      );
      if (fit > 0) setScale(fit);
    });
  }, [size.height, size.width]);
  const font = 13 / scale;
  return (
    <svg
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {props.marks.map((mark) => {
        const x = (mark.x / 100) * size.width;
        const y = (mark.y / 100) * size.height;
        const width = (mark.width / 100) * size.width;
        const height = (mark.height / 100) * size.height;
        const labelY = y > font * 1.8 ? y - font * 0.5 : y + height + font * 1.2;
        return (
          <g key={`${mark.x}:${mark.y}:${mark.label}`}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={font / 3}
              fill="none"
              stroke="var(--color-warning)"
              strokeWidth={2 / scale}
            />
            {mark.label ? (
              <text
                x={x}
                y={labelY}
                fontSize={font}
                fontWeight={600}
                fill="var(--color-warning)"
                paintOrder="stroke"
                stroke="var(--color-background)"
                strokeWidth={font / 5}
              >
                {mark.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Draws the marks over an image shown elsewhere, such as the zoomed view. */
export const markOverlay =
  (marks: ReadonlyArray<PresentationMark>) =>
  (size: { readonly width: number; readonly height: number }) => (
    <MarkOverlay marks={marks} size={size} />
  );

/** The row under the stage that picks a slide: thumbnails for images, names for pages. */
export function SlideStrip(props: {
  readonly slides: ReadonlyArray<Slide>;
  readonly current: number;
  readonly onPick: (index: number) => void;
}) {
  if (props.slides.length < 2) return null;
  const changed = props.slides.some((slide) => slide.changed);
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t p-2">
      {props.slides.map((slide, index) => (
        <button
          key={slide.key}
          type="button"
          aria-label={`Show ${slide.name}${slide.changed ? ", changed in this version" : ""}`}
          aria-current={index === props.current ? "true" : undefined}
          className={cn(
            "relative flex h-14 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            slide.kind !== "image" && "max-w-44 px-2.5 text-xs",
            index === props.current ? "border-foreground" : "opacity-60 hover:opacity-100",
          )}
          onClick={() => props.onPick(index)}
        >
          {slide.changed ? (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-info ring-2 ring-background" />
          ) : null}
          {slide.kind === "image" ? (
            <img src={slide.src} alt="" className="h-full w-auto" />
          ) : (
            <>
              {slide.kind === "doc" ? (
                <FileTextIcon className="size-3.5 shrink-0" />
              ) : slide.kind === "form" ? (
                <ListChecksIcon className="size-3.5 shrink-0" />
              ) : (
                <CodeIcon className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{slide.name}</span>
            </>
          )}
        </button>
      ))}
      {changed ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-muted-foreground text-xs">
          <span className="size-2 rounded-full bg-info" />
          Changed in this version
        </span>
      ) : null}
    </div>
  );
}

/**
 * Steps through a presentation's versions, one per prompt, like commits: back to see what it
 * showed before, forward to now. Hidden until there is more than one.
 */
export function VersionStepper(props: { readonly versions: PresentationVersions }) {
  const { version, available, latest, startedAt, pick, past, loading } = props.versions;
  if (version === undefined || available.length < 2) return null;
  const at = available.indexOf(version);
  const step = (direction: -1 | 1) => {
    const next = available[at + direction];
    if (next !== undefined) pick(next);
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Earlier version"
        disabled={at <= 0}
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <button
        type="button"
        className={cn(
          "rounded px-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          past ? "font-medium text-info" : "text-muted-foreground",
        )}
        aria-label={past ? "Back to the current version" : `Version ${version}`}
        disabled={!past}
        onClick={() => pick(null)}
      >
        {loading
          ? "Loading..."
          : past
            ? `v${version} of ${latest}${startedAt ? `, ${formatRelativeTimeLabel(startedAt)}` : ""}`
            : `v${version}, latest`}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Later version"
        disabled={!past}
        onClick={() => step(1)}
      >
        <ChevronRightIcon />
      </Button>
      {past ? (
        <Button variant="outline" size="xs" onClick={() => pick(null)}>
          Latest
        </Button>
      ) : null}
    </div>
  );
}
