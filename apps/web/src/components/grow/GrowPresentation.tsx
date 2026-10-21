import type { AssetResource, EnvironmentId, ThreadPresentation } from "@t3tools/contracts";
import { CodeIcon, FileTextIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import type { ExpandedImageItem } from "../chat/ExpandedImagePreview";
import { BrowserDocumentFrame } from "../files/BrowserDocumentFrame";
import { ScrollArea } from "../ui/scroll-area";
import { ATTACHMENT_LINK, type Slide, buildSlides } from "./presentation.logic";

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
  return useMemo(() => buildSlides(pages, urls, reportImages), [pages, reportImages, urls]);
}

/** A slide, filling the stage. An image opens larger on click; a page scrolls or runs. */
export function SlideView(props: {
  readonly slide: Slide;
  readonly environmentId: EnvironmentId;
  readonly wide: boolean;
  readonly fit?: boolean | undefined;
  readonly onZoom: () => void;
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
  }
}

/**
 * An image with its marks drawn over it. The overlay is an SVG in the image's own pixel
 * space that letterboxes exactly like `object-contain`, so a box stays on its spot at any size.
 */
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
      {size === null ? null : (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {slide.marks.map((mark) => {
            const x = (mark.x / 100) * size.width;
            const y = (mark.y / 100) * size.height;
            const width = (mark.width / 100) * size.width;
            const height = (mark.height / 100) * size.height;
            const font = Math.max(12, size.width / 70);
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
                  strokeWidth={Math.max(2, size.width / 400)}
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
      )}
    </span>
  );
}

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
