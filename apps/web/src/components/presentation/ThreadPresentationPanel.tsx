import { type ScopedThreadRef } from "@t3tools/contracts";
import { PresentationIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { newMessageId } from "../../lib/utils";
import { usePresentationSeenStore } from "../../presentationSeenStore";
import { useQuietThreadProjection, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { toastManager } from "../ui/toast";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import {
  SlideStrip,
  SlideView,
  VersionStepper,
  markOverlay,
  usePresentationVersion,
  useSlides,
} from "./PresentationSlides";

/**
 * The thread's presentation as a right-panel tab: what its agent did, shown rather than told
 * (before and after shots, marked screenshots, GIFs, open decisions). Looking at it marks it
 * seen, which clears the "updated" dot on the tab.
 */
export function ThreadPresentationPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const thread = useThreadShell(threadRef);
  const presentation = useQuietThreadProjection(threadRef)?.projection.thread.presentation ?? null;
  const { presentation: shown, versions } = usePresentationVersion(
    threadRef.environmentId,
    `${threadRef.environmentId}:${threadRef.threadId}`,
    presentation,
  );
  const slides = useSlides(threadRef.environmentId, shown, versions.version);
  const markSeen = usePresentationSeenStore((state) => state.markSeen);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  // The page being read, by key, so a newer version keeps the reader where they were.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [zoom, setZoom] = useState<number | null>(null);
  const index = Math.max(
    0,
    slides.findIndex((slide) => slide.key === pickedKey),
  );
  const slide = slides[index];
  const images = slides.flatMap((candidate) => (candidate.kind === "image" ? [candidate] : []));

  // Being open is looking: the version that is on screen counts as seen.
  const updatedAt = presentation?.updatedAt;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records what is on screen in the seen store
  useEffect(() => {
    if (updatedAt !== undefined && !versions.past) markSeen(threadRef, updatedAt);
  }, [markSeen, threadRef, updatedAt, versions.past]);

  if (thread === null) return null;

  const answer = (requestId: string, text: string) => {
    setAnswers((current) => ({ ...current, [requestId]: text }));
    void startTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      },
    }).then((result) => {
      if (result._tag !== "Failure") return;
      setAnswers(({ [requestId]: _failed, ...rest }) => rest);
      toastManager.add({ type: "error", title: "Could not send the answer" });
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
            The agent builds one as it works: before and after shots, proof and open decisions.
          </p>
        </div>
      ) : (
        <SlideView
          slide={slide}
          threadRef={threadRef}
          onZoom={() => setZoom(images.findIndex((candidate) => candidate.key === slide.key))}
          answers={answers}
          onAnswer={answer}
          readOnly={versions.past}
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
