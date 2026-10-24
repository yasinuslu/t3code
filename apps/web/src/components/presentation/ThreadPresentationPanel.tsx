import type { ScopedThreadRef } from "@t3tools/contracts";
import { PresentationIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePresentationSeenStore } from "../../presentationSeenStore";
import { useThreadShell } from "../../state/entities";
import { toastManager } from "../ui/toast";
import { ScrollArea } from "../ui/scroll-area";
import ChatMarkdown from "../ChatMarkdown";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import {
  SlideStrip,
  SlideView,
  VersionStepper,
  markOverlay,
  usePresentationVersion,
  useSlides,
} from "../grow/GrowPresentation";
import { useSendGrowRequest } from "../grow/useSendGrowRequest";
import { useReportImages, useThreadReport } from "../home/ThreadReportCard";
import type { WidgetThreadFacts } from "../../widgetFrame/protocol";

/**
 * The thread's presentation as a right-panel tab: the dashboard its agent keeps current (where
 * things stand, proof images, open decisions). Pages are drawn with the same renderers as Grow,
 * and a doc page's web components answer on the thread itself. Looking at it marks it seen, which
 * clears the "updated" dot on the header button.
 */
export function ThreadPresentationPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const thread = useThreadShell(threadRef);
  if (thread === null) return null;
  return <PresentationBody threadRef={threadRef} thread={thread} />;
}

function PresentationBody(props: {
  readonly threadRef: ScopedThreadRef;
  readonly thread: NonNullable<ReturnType<typeof useThreadShell>>;
}) {
  const { threadRef, thread } = props;
  const { digest, presentation, growRequests } = useThreadReport(thread);
  const reportImages = useReportImages(thread.environmentId, thread.id, digest.screenshots);
  const { presentation: shown, versions } = usePresentationVersion(
    thread.environmentId,
    `${thread.environmentId}:${thread.id}`,
    presentation,
  );
  const slides = useSlides(thread.environmentId, shown, reportImages, versions.version);
  const sendRequest = useSendGrowRequest();
  const markSeen = usePresentationSeenStore((state) => state.markSeen);

  // The page being read, by key, so a newer version keeps the reader where they were.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const index = Math.max(
    0,
    slides.findIndex((slide) => slide.key === pickedKey),
  );
  const slide = slides[index];
  const [zoom, setZoom] = useState<number | null>(null);
  const images = useMemo(
    () => slides.flatMap((candidate) => (candidate.kind === "image" ? [candidate] : [])),
    [slides],
  );
  const facts = useMemo(
    (): WidgetThreadFacts => ({ title: thread.title, status: thread.latestRun?.status ?? "" }),
    [thread.title, thread.latestRun?.status],
  );

  // Being open is looking: the version that is on screen counts as seen.
  const updatedAt = presentation?.updatedAt;
  useEffect(() => {
    if (updatedAt !== undefined && !versions.past) markSeen(threadRef, updatedAt);
  }, [markSeen, threadRef, updatedAt, versions.past]);

  const answer = (requestId: string, text: string) => {
    void sendRequest(thread, "form", text, { id: requestId }).then((sent) => {
      if (!sent) toastManager.add({ type: "error", title: "Could not send the answer" });
    });
  };

  return (
    <section
      aria-label="Presentation"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-thread-presentation={thread.id}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <PresentationIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {slide?.name ?? "Presentation"}
        </span>
        {slides.length > 1 ? (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {index + 1} / {slides.length}
          </span>
        ) : null}
        <VersionStepper versions={versions} />
      </header>
      {slide === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="font-medium text-sm">No presentation yet</p>
          <p className="max-w-64 text-muted-foreground text-xs">
            The agent builds one as it works: where things stand, proof and open decisions.
          </p>
        </div>
      ) : slide.kind === "doc" ? (
        <ScrollArea className="min-h-0 flex-1">
          {/* Not inside SlideView: a component's answer is a message on this thread. */}
          <ChatMarkdown
            key={slide.key}
            text={slide.markdown}
            cwd={undefined}
            environmentId={thread.environmentId}
            threadRef={threadRef}
            className="px-4 py-4"
          />
        </ScrollArea>
      ) : (
        <SlideView
          slide={slide}
          environmentId={thread.environmentId}
          wide
          onZoom={() => setZoom(images.findIndex((candidate) => candidate.key === slide.key))}
          requests={growRequests}
          onAnswer={answer}
          readOnly={versions.past}
          thread={facts}
        />
      )}
      <SlideStrip
        slides={slides}
        current={index}
        onPick={(next) => setPickedKey(slides[next]?.key ?? null)}
      />
      {zoom === null ? null : (
        <ExpandedImageDialog
          preview={{
            images: images.map(({ src, name, marks }) => ({
              src,
              name,
              ...(marks.length > 0 ? { overlay: markOverlay(marks) } : {}),
            })),
            index: zoom,
          }}
          onClose={() => setZoom(null)}
        />
      )}
    </section>
  );
}
