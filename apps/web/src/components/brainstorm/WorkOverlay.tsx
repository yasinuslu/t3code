/**
 * The work overlay: a read-only glance at everything in flight, opened above
 * the current view and closed with Esc. Goals and tasks come from the brain
 * task files (the brainstorm state stream), threads from the live thread
 * shells of every connected environment. Nothing here reads the manager's chat.
 */
import {
  type WorkGroup,
  type WorkItem,
  type WorkReason,
  buildWorkOverview,
} from "@t3tools/client-runtime/state/work-overview";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { useBrainstormStore, useThreadShellsWithoutBrainstorms } from "../../brainstormStore";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ThreadContextChip } from "../ThreadContextChip";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { type BoardGoal, boardGoals } from "./brainstorm.logic";

/** Time labels move on while the overlay stays open; a coarse tick is enough. */
const CLOCK_TICK_MS = 30_000;
const OPEN_TASKS_SHOWN = 3;

const GROUPS: ReadonlyArray<{
  readonly group: WorkGroup;
  readonly title: string;
  readonly empty: string;
}> = [
  { group: "needsMe", title: "Needs me", empty: "Nothing is waiting on you." },
  { group: "working", title: "Working", empty: "No agent is running." },
  { group: "review", title: "Ready for review", empty: "Nothing to review." },
  { group: "done", title: "Recently done", empty: "Nothing settled in the last day." },
];

const REASON_LABEL: Readonly<Record<WorkReason, string>> = {
  approval: "needs approval",
  input: "asked a question",
  failed: "failed",
  limited: "hit a usage limit",
  working: "working",
  waiting: "waiting on background work",
  ready: "finished",
  settled: "settled",
};

export function WorkOverlay() {
  const open = useBrainstormStore((state) => state.workOverlayOpen);
  const setOpen = useBrainstormStore((state) => state.setWorkOverlayOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? <WorkOverlayPopup onNavigate={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function WorkOverlayPopup(props: { readonly onNavigate: () => void }) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const managerThreadKey = useBrainstormStore((state) => state.managerThreadKey);
  const threads = useThreadShellsWithoutBrainstorms();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const overview = useMemo(
    () =>
      buildWorkOverview(
        threads.filter((thread) => `${thread.environmentId}:${thread.id}` !== managerThreadKey),
        now,
      ),
    [managerThreadKey, now, threads],
  );
  const brainstorm = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : brainstormEnvironment.state({ environmentId: primaryEnvironmentId, input: {} }),
  ).data;
  const goals = useMemo(() => boardGoals(brainstorm?.taskLists ?? [], ALL_SPACE_ID), [brainstorm]);
  const shortcut = shortcutLabelForCommand(keybindings, "workOverlay.toggle");

  return (
    <DialogPopup className="sm:max-w-5xl" data-work-overlay="">
      <DialogHeader>
        <DialogTitle>Work</DialogTitle>
        <DialogDescription>
          {overview.needsMe.length} need you · {overview.working.length} working ·{" "}
          {overview.review.length} to review{shortcut ? ` · ${shortcut} or Esc to close` : ""}
        </DialogDescription>
      </DialogHeader>
      {/* Any link inside (thread chips, task threads) leaves the overlay behind. */}
      <DialogPanel
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("a[href]")) props.onNavigate();
        }}
      >
        {/* Threads on the left, goals beside them on wide screens. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {GROUPS.map(({ group, title, empty }) => (
              <section key={group} aria-label={title} data-work-group={group}>
                <h3 className="mb-1.5 font-medium text-muted-foreground text-xs">
                  {title}
                  {overview[group].length > 0 ? ` · ${overview[group].length}` : ""}
                </h3>
                {overview[group].length === 0 ? (
                  <p className="text-muted-foreground text-xs">{empty}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {overview[group].map((item) => (
                      <WorkThreadRow
                        key={`${item.thread.environmentId}:${item.thread.id}`}
                        item={item}
                        now={now}
                        primaryEnvironmentId={primaryEnvironmentId}
                        showPreview={group !== "done"}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <section aria-label="Goals" data-work-group="goals" className="min-w-0">
            <h3 className="mb-1.5 font-medium text-muted-foreground text-xs">
              Goals{goals.length > 0 ? ` · ${goals.length}` : ""}
            </h3>
            {goals.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No open goals. Ask the manager to plan one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {goals.map((goal) => (
                  <GoalRow key={goal.key} goal={goal} environmentId={primaryEnvironmentId} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogPanel>
    </DialogPopup>
  );
}

function WorkThreadRow(props: {
  readonly item: WorkItem<EnvironmentThreadShell>;
  readonly now: number;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly showPreview: boolean;
}) {
  const { thread, reason, lastActivityAt } = props.item;
  const projectKey = `${thread.environmentId}:${thread.projectId}`;
  const projects = useProjects();
  const projectTitle = useMemo(
    () =>
      projects.find(
        (project) =>
          project.environmentId === thread.environmentId && project.id === thread.projectId,
      )?.title ?? null,
    [projects, thread.environmentId, thread.projectId],
  );
  const profile = useSpaceStore((state) => state.detectedProfileByProjectKey[projectKey] ?? null);
  const pullRequests = (thread.pullRequests ?? []).filter(
    (pullRequest) => pullRequest.source !== "stack-dismissed",
  );
  const branchPullRequest =
    pullRequests.length === 0
      ? (thread.linkedPullRequest ?? thread.branchPullRequest ?? null)
      : null;
  return (
    <li
      className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs"
      data-work-thread={thread.id}
    >
      <span className="flex min-w-0 max-w-[55%] shrink-0">
        <ThreadContextChip
          record={{ environmentId: thread.environmentId, threadId: thread.id, title: thread.title }}
          currentEnvironmentId={props.primaryEnvironmentId}
        />
      </span>
      <span
        className={cn(
          "shrink-0",
          reason === "failed" || reason === "limited"
            ? "text-destructive-foreground"
            : "text-muted-foreground",
        )}
      >
        {REASON_LABEL[reason]}
      </span>
      {projectTitle ? (
        <span className="min-w-0 truncate text-muted-foreground">{projectTitle}</span>
      ) : null}
      {profile ? (
        <Badge variant="outline" size="sm">
          {profile}
        </Badge>
      ) : null}
      {thread.branch ? (
        <span className="min-w-0 truncate font-mono text-muted-foreground">{thread.branch}</span>
      ) : null}
      {pullRequests.map((pullRequest) => (
        <a
          key={`${pullRequest.repository}#${pullRequest.number}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          #{pullRequest.number}
          {pullRequest.snapshot ? ` ${pullRequest.snapshot.state}` : ""}
        </a>
      ))}
      {branchPullRequest ? (
        <a
          className="shrink-0 text-muted-foreground hover:text-foreground"
          href={branchPullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          #{branchPullRequest.number}
        </a>
      ) : null}
      {props.showPreview ? (
        <ThreadPreviewLinks environmentId={thread.environmentId} threadId={thread.id} />
      ) : null}
      <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
        {relativeLabel(lastActivityAt, props.now)}
      </span>
    </li>
  );
}

/** The pages open in the thread's preview panel, when it has any. */
function ThreadPreviewLinks(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: EnvironmentThreadShell["id"];
}) {
  const previews = useEnvironmentQuery(
    previewEnvironment.list({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  ).data;
  const urls = [
    ...new Set(
      (previews?.sessions ?? []).flatMap((session) =>
        session.navStatus._tag === "Idle" ? [] : [session.navStatus.url],
      ),
    ),
  ];
  return urls.map((url) => (
    <a
      key={url}
      className="min-w-0 max-w-56 shrink truncate text-muted-foreground hover:text-foreground"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {url.replace(/^https?:\/\//, "")}
    </a>
  ));
}

function GoalRow(props: {
  readonly goal: BoardGoal;
  readonly environmentId: EnvironmentId | null;
}) {
  const { goal } = props;
  const doneCount = goal.tasks.filter((task) => task.done).length;
  const total = goal.tasks.length;
  const openTasks = goal.tasks.filter((task) => !task.done);
  return (
    <li className="rounded-md border px-2.5 py-1.5" data-goal={goal.title}>
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{goal.title}</span>
        <span className="shrink-0 text-muted-foreground">{goal.spaceName}</span>
        <span
          className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`${goal.title} progress`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
        >
          <span
            className="block h-full bg-primary"
            style={{ width: total === 0 ? "0%" : `${(doneCount / total) * 100}%` }}
          />
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {doneCount}/{total}
        </span>
      </div>
      {openTasks.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {openTasks.slice(0, OPEN_TASKS_SHOWN).map((task) => (
            <li
              key={`${task.number}:${task.title}`}
              className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground text-xs"
            >
              <span className="min-w-0 truncate">{task.title}</span>
              {props.environmentId !== null
                ? task.threadIds.map((threadId) => (
                    <ThreadContextChip
                      key={threadId}
                      record={{
                        environmentId: props.environmentId as EnvironmentId,
                        threadId: threadId as EnvironmentThreadShell["id"],
                        title: "thread",
                      }}
                    />
                  ))
                : null}
            </li>
          ))}
          {openTasks.length > OPEN_TASKS_SHOWN ? (
            <li className="text-muted-foreground text-xs">
              {openTasks.length - OPEN_TASKS_SHOWN} more open
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function relativeLabel(iso: string, now: number): string {
  const elapsedMs = now - Date.parse(iso);
  if (Number.isNaN(elapsedMs)) return "";
  return elapsedMs < 60_000 ? "just now" : formatRelativeTimeLabel(iso);
}
