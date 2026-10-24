/**
 * The status card of a thread: its latest report (or the status its agent set
 * with `thread_status_update`) digested into a summary, what changed,
 * screenshots and what needs the user. Home and Grow show it per work card.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { WorkReason } from "@t3tools/client-runtime/state/work-overview";
import type { AssetResource, EnvironmentId, ThreadGrowRequest } from "@t3tools/contracts";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { brainstormEnvironment } from "../../state/brainstorm";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import type { ExpandedImageItem } from "../chat/ExpandedImagePreview";
import { Button } from "../ui/button";
import { type ReportScreenshot, type ThreadReportDigest, digestThreadReport } from "./home.logic";

export const WORK_REASON_LOOK: Readonly<
  Record<WorkReason, { readonly label: string; readonly dot: string }>
> = {
  approval: { label: "Waiting for your approval", dot: "bg-warning" },
  input: { label: "Asked you a question", dot: "bg-warning" },
  failed: { label: "Failed", dot: "bg-destructive" },
  limited: { label: "Hit a usage limit", dot: "bg-destructive" },
  working: { label: "Working", dot: "bg-info" },
  waiting: { label: "Waiting on background work", dot: "bg-info/60" },
  ready: { label: "Finished, not settled", dot: "bg-success" },
  settled: { label: "Settled", dot: "bg-muted-foreground/50" },
};

const NO_GROW_REQUESTS: ReadonlyArray<ThreadGrowRequest> = [];

/** The thread's latest report digested, plus the previews and pull requests it links. */
export function useThreadReport(thread: EnvironmentThreadShell) {
  const runId = thread.latestRun?.runId ?? null;
  const statusUpdatedAt = thread.statusUpdatedAt;
  const presentationUpdatedAt = thread.presentationUpdatedAt;
  const growRequestsUpdatedAt = thread.growRequestsUpdatedAt;
  const report = useEnvironmentQuery(
    runId === null &&
      statusUpdatedAt === undefined &&
      presentationUpdatedAt === undefined &&
      growRequestsUpdatedAt === undefined
      ? null
      : brainstormEnvironment.threadReport({
          environmentId: thread.environmentId,
          input: {
            threadId: thread.id,
            runId,
            ...(statusUpdatedAt === undefined ? {} : { statusUpdatedAt }),
            ...(presentationUpdatedAt === undefined ? {} : { presentationUpdatedAt }),
            ...(growRequestsUpdatedAt === undefined ? {} : { growRequestsUpdatedAt }),
          },
        }),
  ).data;
  const text = report?.text;
  const statusText = report?.statusText;
  const digest = useMemo(() => {
    const latest = digestThreadReport(text);
    // A later answer without images still has the status report's proof.
    if (latest.screenshots.length > 0 || !statusText) return latest;
    return { ...latest, screenshots: digestThreadReport(statusText).screenshots };
  }, [text, statusText]);
  const previews = useEnvironmentQuery(
    previewEnvironment.list({
      environmentId: thread.environmentId,
      input: { threadId: thread.id },
    }),
  ).data;
  const tryUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const session of previews?.sessions ?? []) {
      if (session.navStatus._tag !== "Idle") urls.add(session.navStatus.url);
    }
    for (const url of digest.tryUrls) urls.add(url);
    return [...urls].slice(0, 2);
  }, [digest.tryUrls, previews]);
  const pullRequests = useMemo(
    () =>
      (thread.pullRequests ?? []).filter((pullRequest) => pullRequest.source !== "stack-dismissed"),
    [thread.pullRequests],
  );
  return {
    digest,
    tryUrls,
    pullRequests,
    presentation: report?.presentation ?? null,
    growRequests: report?.growRequests ?? NO_GROW_REQUESTS,
  };
}

/** Try it and pull request buttons; `children` go between them. */
export function ThreadReportLinks(props: {
  readonly tryUrls: ReadonlyArray<string>;
  readonly pullRequests: ReturnType<typeof useThreadReport>["pullRequests"];
  readonly children?: ReactNode;
}) {
  if (props.tryUrls.length === 0 && props.pullRequests.length === 0 && !props.children) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.tryUrls.map((url) => (
        <Button
          key={url}
          size="sm"
          variant="default"
          render={<a href={url} target="_blank" rel="noopener noreferrer" />}
        >
          <PlayIcon />
          Try it: {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </Button>
      ))}
      {props.children}
      {props.pullRequests.map((pullRequest) => (
        <Button
          key={`${pullRequest.repository}#${pullRequest.number}`}
          size="sm"
          variant="ghost-muted"
          render={<a href={pullRequest.url} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />#{pullRequest.number}
          {pullRequest.snapshot ? ` ${pullRequest.snapshot.state}` : ""}
        </Button>
      ))}
    </div>
  );
}

/** Summary, what changed, screenshots and what needs the user. */
export function ThreadReportBody(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: EnvironmentThreadShell["id"];
  readonly digest: ThreadReportDigest;
}) {
  const { digest } = props;
  return (
    <>
      {digest.summary ? (
        <p className="line-clamp-3 text-sm leading-relaxed">{digest.summary}</p>
      ) : null}
      {digest.bullets.length > 0 ? (
        <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground text-sm">
          {digest.bullets.map((bullet) => (
            <li key={bullet}>
              <span className="line-clamp-2">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {digest.screenshots.length > 0 ? (
        <ReportScreenshots
          environmentId={props.environmentId}
          threadId={props.threadId}
          screenshots={digest.screenshots}
        />
      ) : null}
      {digest.questions.length > 0 ? (
        <div className="rounded-md border-warning/60 border-s-3 bg-warning-surface px-3 py-2 text-sm">
          {digest.questions.map((question) => (
            <p key={question}>{question}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The report's screenshots, served from the thread's machine. Clicking one
 * opens them all in the media viewer, starting at that one.
 */
function ReportScreenshots(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: EnvironmentThreadShell["id"];
  readonly screenshots: ReadonlyArray<ReportScreenshot>;
}) {
  const images = useReportImages(props.environmentId, props.threadId, props.screenshots);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Screenshots">
      {images.map((image, index) => (
        <button
          key={image.src}
          type="button"
          className="cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${image.name}`}
          onClick={() => setOpenIndex(index)}
        >
          <img
            src={image.src ?? undefined}
            alt={image.name}
            loading="lazy"
            className="h-24 max-w-full rounded-md border object-cover"
          />
        </button>
      ))}
      {openIndex !== null ? (
        <ExpandedImageDialog
          preview={{ images, index: openIndex }}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </div>
  );
}

/** A report's screenshots as viewer images, served from the thread's machine; the ones not served yet are left out. */
export function useReportImages(
  environmentId: EnvironmentId,
  threadId: EnvironmentThreadShell["id"],
  screenshots: ReadonlyArray<ReportScreenshot>,
): ExpandedImageItem[] {
  const resources = useMemo(
    () =>
      screenshots.map((shot): AssetResource =>
        "attachmentId" in shot
          ? { _tag: "attachment", attachmentId: shot.attachmentId }
          : { _tag: "media-file", threadId, path: shot.path },
      ),
    [screenshots, threadId],
  );
  const urls = useAssetUrls(environmentId, resources);
  const images = useMemo(
    () =>
      screenshots.flatMap((shot, index): ExpandedImageItem[] => {
        const src = urls[index];
        return src ? [{ src, name: shot.alt }] : [];
      }),
    [screenshots, urls],
  );
  return images;
}
