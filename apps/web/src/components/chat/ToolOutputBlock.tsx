import { useAtomValue } from "@effect/atom-react";
import {
  EventId,
  type EnvironmentId,
  type OrchestrationGetActivityOutputResult,
  type ThreadId,
} from "@t3tools/contracts";
import { CheckIcon, CircleXIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { Spinner } from "../ui/spinner";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import {
  deriveFailedCommandSummary,
  formatToolDuration,
  rememberLoadedToolOutput,
  type FailedCommandSummary,
} from "./ToolOutputBlock.logic";

const outputPreClassName =
  "max-h-72 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

interface ActivityOutputRef {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  activityId: string;
}

function useActivityOutput(props: ActivityOutputRef) {
  const result = useAtomValue(
    orchestrationEnvironment.activityOutput({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, activityId: EventId.make(props.activityId) },
    }),
  );
  const output = result._tag === "Success" ? result.value.output : null;
  useEffect(() => {
    if (output !== null) rememberLoadedToolOutput(props.activityId, output);
  }, [output, props.activityId]);
  return result;
}

/**
 * Full output of one tool call. Snapshots only carry a one-line summary, so
 * the output is fetched when the row is expanded (never for collapsed rows)
 * and rendered in a bounded, scrollable block.
 */
export function ToolOutputBlock(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  activityId: string;
  running: boolean;
  failed: boolean;
  className?: string | undefined;
  /** False when the row already shows the image elsewhere. */
  showImage?: boolean | undefined;
  /** Search text to mark in the output. */
  highlight?: string | undefined;
}) {
  if (props.running) {
    return (
      <div
        className={cn("text-xs text-muted-foreground", props.className)}
        data-tool-output="running"
      >
        Running…
      </div>
    );
  }
  return <SettledToolOutput {...props} />;
}

function SettledToolOutput(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  activityId: string;
  failed: boolean;
  className?: string | undefined;
  showImage?: boolean | undefined;
  highlight?: string | undefined;
}) {
  const result = useActivityOutput(props);
  if (result._tag === "Success") {
    const { output, truncated, image } = result.value;
    const imageBlock =
      image && props.showImage !== false ? <ToolOutputImage image={image} name="Image" /> : null;
    if (output === null) {
      if (image) {
        return imageBlock ? (
          <div className={props.className} data-tool-output="image">
            {imageBlock}
          </div>
        ) : null;
      }
      return (
        <div
          className={cn("text-xs text-muted-foreground", props.className)}
          data-tool-output="empty"
        >
          No output
        </div>
      );
    }
    return (
      <div className={props.className} data-tool-output={props.failed ? "error" : "output"}>
        <div
          className={cn(
            "mb-1 text-3xs font-medium uppercase tracking-wider",
            props.failed ? "text-destructive-foreground" : "text-muted-foreground/80",
          )}
        >
          {props.failed ? "Error output" : "Output"}
          {truncated ? " · truncated" : ""}
        </div>
        <pre className={outputPreClassName}>
          <HighlightedText text={output} query={props.highlight} />
        </pre>
        {imageBlock ? <div className="mt-2">{imageBlock}</div> : null}
      </div>
    );
  }
  if (result._tag === "Failure") {
    return (
      <div
        className={cn("text-xs text-destructive-foreground", props.className)}
        data-tool-output="unavailable"
      >
        Output unavailable
      </div>
    );
  }
  return (
    <div
      className={cn("text-xs text-muted-foreground", props.className)}
      data-tool-output="loading"
    >
      Loading output…
    </div>
  );
}

/** Marks each case-insensitive occurrence of `query` in `text`. */
export function HighlightedText({ text, query }: { text: string; query?: string | undefined }) {
  const needle = query?.trim().toLocaleLowerCase();
  if (!needle) return text;
  const haystack = text.toLocaleLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let offset = 0;
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, offset)
  ) {
    if (index > offset) parts.push({ text: text.slice(offset, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    offset = index + needle.length;
  }
  if (parts.length === 0) return text;
  if (offset < text.length) parts.push({ text: text.slice(offset), match: false });
  return parts.map((part, index) =>
    part.match ? (
      <mark key={index} className="rounded-[2px] bg-warning/35 text-foreground" data-search-match>
        {part.text}
      </mark>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}

/** Duration and outcome glyph at the right edge of a tool row. */
export function ToolRowStatus(props: {
  startedAt: string | undefined;
  endedAt: string;
  state: "running" | "completed" | "failed";
  className?: string | undefined;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const { startedAt, state } = props;
  // Live rows tick through DOM writes, with no React commit per second.
  useEffect(() => {
    if (state !== "running" || !startedAt) return;
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = formatToolDuration(startedAt, new Date().toISOString()) ?? "";
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, state]);
  const duration = state === "running" ? null : formatToolDuration(props.startedAt, props.endedAt);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-2xs tabular-nums text-muted-foreground",
        props.className,
      )}
      data-tool-row-status={state}
    >
      <span ref={textRef}>{duration}</span>
      {state === "running" ? (
        <Spinner aria-label="Running" className="size-3 text-info" />
      ) : state === "failed" ? (
        <CircleXIcon aria-label="Failed" className="size-3 text-destructive" />
      ) : (
        <CheckIcon aria-label="Completed" className="size-3 text-success" />
      )}
    </span>
  );
}

/**
 * Exit code and first error line of a failed command, for its collapsed row.
 * Fetched only for failed command rows, which are few.
 */
export function useFailedCommandSummary(props: ActivityOutputRef): FailedCommandSummary | null {
  const result = useActivityOutput(props);
  return result._tag === "Success" ? deriveFailedCommandSummary(result.value.output) : null;
}

/** Inline thumbnail of an image a tool returned; hover previews it, click enlarges it. */
export function ToolImageThumbnail(props: ActivityOutputRef & { name: string }) {
  const result = useActivityOutput(props);
  const image = result._tag === "Success" ? result.value.image : undefined;
  if (!image) return null;
  return <ToolOutputImage image={image} name={props.name} thumbnail />;
}

type ToolImage = NonNullable<OrchestrationGetActivityOutputResult["image"]>;

function ToolOutputImage(props: { image: ToolImage; name: string; thumbnail?: boolean }) {
  const { image, name } = props;
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (image.data === null) {
    return (
      <span className="shrink-0 text-2xs text-muted-foreground" data-tool-image="too-large">
        image too large ({(image.byteLength / (1024 * 1024)).toFixed(1)} MB)
      </span>
    );
  }
  const src = `data:${image.mimeType};base64,${image.data}`;
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) =>
    setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
  const open = (event: SyntheticEvent) => {
    event.stopPropagation();
    setExpanded(true);
  };
  const trigger = (
    <button
      type="button"
      className={cn(
        "shrink-0 cursor-zoom-in overflow-hidden rounded-sm border border-border/70 bg-muted/40",
        props.thumbnail ? "h-4.5 w-7" : "max-w-full",
      )}
      aria-label={`Open ${name}`}
      onClick={open}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      data-tool-image={props.thumbnail ? "thumbnail" : "output"}
    >
      <img
        src={src}
        alt={name}
        onLoad={onLoad}
        className={props.thumbnail ? "size-full object-cover" : "max-h-48 w-auto object-contain"}
      />
    </button>
  );
  return (
    <>
      <PreviewCard>
        <PreviewCardTrigger render={trigger} delay={250} closeDelay={80} />
        <PreviewCardPopup side="bottom" className="w-auto max-w-96 overflow-hidden p-0">
          <img
            src={src}
            alt={name}
            className="max-h-64 w-full bg-muted/40 object-contain"
            data-tool-image="preview"
          />
          <div className="flex items-baseline gap-2 border-t px-2.5 py-1.5 text-2xs text-muted-foreground">
            <span className="min-w-0 truncate font-mono text-foreground">{name}</span>
            {size ? (
              <span className="shrink-0 tabular-nums">
                {size.width} × {size.height}
              </span>
            ) : null}
            <span className="ml-auto shrink-0">Click to enlarge</span>
          </div>
        </PreviewCardPopup>
      </PreviewCard>
      {expanded ? (
        <ExpandedImageDialog
          preview={{ images: [{ src, name }], index: 0 }}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </>
  );
}
