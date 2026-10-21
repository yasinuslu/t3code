import type {
  AssetResource,
  EnvironmentId,
  PresentationMark,
  ThreadGrowRequest,
  ThreadPresentation,
} from "@t3tools/contracts";
import { CheckIcon, CodeIcon, FileTextIcon, ListChecksIcon } from "lucide-react";
import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import type { ExpandedImageItem } from "../chat/ExpandedImagePreview";
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

/**
 * The item's slides: its presentation's pages when the agent set one, otherwise the images of
 * its status report, so threads from before presentations still show their proof.
 */
export function useSlides(
  environmentId: EnvironmentId,
  presentation: ThreadPresentation | null,
  reportImages: ReadonlyArray<ExpandedImageItem>,
): ReadonlyArray<Slide> {
  const pages = presentation?.pages;
  // Every file the pages point at, in page order, resolved in one batch.
  const resources = useMemo(() => {
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
  }, [pages]);
  const urls = useAssetUrls(environmentId, resources);
  const at = presentation?.updatedAt;
  return useMemo(() => buildSlides(pages, urls, reportImages, at), [at, pages, reportImages, urls]);
}

/** A slide, filling the stage. An image opens larger on click; a page scrolls or runs. */
export function SlideView(props: {
  readonly slide: Slide;
  readonly environmentId: EnvironmentId;
  readonly wide: boolean;
  readonly fit?: boolean | undefined;
  readonly onZoom: () => void;
  readonly requests: ReadonlyArray<ThreadGrowRequest>;
  readonly onAnswer: (requestId: string, text: string) => void;
}) {
  const { slide } = props;
  switch (slide.kind) {
    case "image":
      return (
        <button
          type="button"
          className={cn(
            "flex min-h-0 cursor-zoom-in items-center justify-center p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !props.fit && "flex-1",
          )}
          aria-label={`Open ${slide.name}`}
          onClick={props.onZoom}
        >
          <MarkedImage
            slide={slide}
            className={
              props.fit
                ? "max-h-[42vh] w-auto max-w-full"
                : props.wide
                  ? "size-full"
                  : "max-h-[45vh] max-w-full"
            }
          />
        </button>
      );
    case "doc":
      return (
        <ScrollArea className={cn("min-h-0", props.fit ? "max-h-[42vh]" : "flex-1")}>
          <ChatMarkdown
            text={slide.markdown}
            cwd={undefined}
            environmentId={props.environmentId}
            className="mx-auto max-w-3xl px-6 py-5"
          />
        </ScrollArea>
      );
    case "html":
      return (
        <div className={cn("flex min-h-0 flex-col", props.fit ? "h-[42vh]" : "min-h-80 flex-1")}>
          <BrowserDocumentFrame src={slide.src} title={slide.name} pdf={false} />
        </div>
      );
    case "form":
      return (
        <ScrollArea className={cn("min-h-0", props.fit ? "max-h-[42vh]" : "flex-1")}>
          <FormSlide
            key={slide.requestId}
            slide={slide}
            answered={props.requests.findLast((request) => request.id === slide.requestId)}
            onAnswer={(text) => props.onAnswer(slide.requestId, text)}
          />
        </ScrollArea>
      );
  }
}

/** A form page: the agent's questions, answered here and sent back to the thread. */
function FormSlide(props: {
  readonly slide: Extract<Slide, { kind: "form" }>;
  readonly answered: ThreadGrowRequest | undefined;
  readonly onAnswer: (text: string) => void;
}) {
  const { slide, answered } = props;
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState(false);
  // What was just sent, until the thread records it (the answer it replaces, if any).
  const [sent, setSent] = useState<{ readonly text: string; readonly over?: string } | null>(null);
  const sending = sent !== null && answered?.openedAt === sent.over;
  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));
  const complete = formComplete(slide.fields, answers);
  const edit = () => {
    setAnswers(formAnswersFromText(slide.fields, (sending ? sent.text : answered?.text) ?? ""));
    setEditing(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    const text = formAnswerText(slide.fields, answers);
    props.onAnswer(text);
    setSent(answered === undefined ? { text } : { text, over: answered.openedAt });
    setEditing(false);
  };
  if ((answered !== undefined || sending) && !editing) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-5">
        <p className="flex items-center gap-1.5 font-medium text-sm">
          <CheckIcon className="size-4 text-success" />
          {sending || answered === undefined
            ? "Sent"
            : `Answered ${formatRelativeTimeLabel(answered.openedAt)}`}
        </p>
        <p className="whitespace-pre-line text-muted-foreground text-sm">
          {sending ? sent.text : answered?.text}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={sending}
          onClick={edit}
        >
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
              value={answers[field.id] ?? ""}
              onChange={(event) => set(field.id, event.currentTarget.value)}
            />
          )}
        </fieldset>
      ))}
      <div className="flex gap-2">
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
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const fit = Math.min(
        entry.contentRect.width / size.width,
        entry.contentRect.height / size.height,
      );
      if (fit > 0) setScale(fit);
    });
    observer.observe(svg);
    return () => observer.disconnect();
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
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t p-2">
      {props.slides.map((slide, index) => (
        <button
          key={slide.key}
          type="button"
          aria-label={`Show ${slide.name}`}
          aria-current={index === props.current ? "true" : undefined}
          className={cn(
            "flex h-14 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring",
            slide.kind !== "image" && "max-w-44 px-2.5 text-xs",
            index === props.current ? "border-foreground" : "opacity-60 hover:opacity-100",
          )}
          onClick={() => props.onPick(index)}
        >
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
    </div>
  );
}
