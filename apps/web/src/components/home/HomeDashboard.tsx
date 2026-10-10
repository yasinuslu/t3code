/**
 * Home: the dashboard the user stays on. Work cards on the left, built like
 * the HTML reports agents write (status dot, one-line verdict, Try it / Open
 * thread, screenshots, open questions), and the manager thread docked on the
 * right as the real thread view. Everything comes from durable state: thread
 * shells, each thread's latest report, preview sessions and the brain task
 * files; nothing reads the manager's chat memory. Home shows the active
 * space's work and its profile's manager; the profile switcher in the header
 * changes both.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type WorkGroup,
  type WorkItem,
  type WorkReason,
  buildWorkOverview,
} from "@t3tools/client-runtime/state/work-overview";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CompassIcon, ExternalLinkIcon, MessagesSquareIcon, PlayIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { useHomeThreadShells, useManagerProfile } from "../../brainstormStore";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment, useManagerEnvironmentId } from "../../state/brainstorm";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatView from "../ChatView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { type BoardGoal, goalsOfSpace } from "../brainstorm/brainstorm.logic";
import { ManagerProfileSwitcher } from "../brainstorm/ManagerProfileSwitcher";
import { CodeProfileProbes } from "../sidebar/SpaceSwitcher";
import {
  selectManagerProfile,
  useEnsureManagerThread,
  useOpenManagerThreadPage,
} from "../brainstorm/useOpenManagerThread";
import { type Verdict, homeVerdict } from "./home.logic";
import {
  ThreadReportBody,
  ThreadReportLinks,
  WORK_REASON_LOOK,
  useThreadReport,
} from "./ThreadReportCard";

/** Time labels move on while the page stays open; a coarse tick is enough. */
const CLOCK_TICK_MS = 30_000;
const OPEN_TASKS_SHOWN = 3;

const CARD_GROUPS: ReadonlyArray<{ readonly group: WorkGroup; readonly title: string }> = [
  { group: "needsMe", title: "Needs you" },
  { group: "working", title: "Working" },
  { group: "review", title: "Ready for review" },
];

const VERDICT_LOOK: Readonly<
  Record<Verdict["tone"], { readonly lead: string; readonly bar: string }>
> = {
  attention: { lead: "text-warning-foreground", bar: "from-warning/14" },
  busy: { lead: "text-info-foreground", bar: "from-info/14" },
  calm: { lead: "text-success-foreground", bar: "from-success/14" },
};

export function HomeDashboard() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useHomeThreadShells();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const overview = useMemo(() => buildWorkOverview(threads, now), [now, threads]);
  const verdict = homeVerdict(overview);
  const managerProfile = useManagerProfile();
  // Goals come from the brain of the manager in view.
  const managerEnvironmentId = useManagerEnvironmentId(managerProfile);
  const brainstorm = useEnvironmentQuery(
    managerEnvironmentId === null
      ? null
      : brainstormEnvironment.state({ environmentId: managerEnvironmentId, input: {} }),
  ).data;
  const activeSpace = useSpaceStore(
    (store) => store.spaces.find((space) => space.id === store.activeSpaceId) ?? null,
  );
  const goals = useMemo(
    () => goalsOfSpace(brainstorm?.taskLists ?? [], activeSpace),
    [activeSpace, brainstorm],
  );
  const manager = useEnsureManagerThread();
  const openManagerThreadPage = useOpenManagerThreadPage();
  const projects = useProjects();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden overscroll-y-none bg-background">
      {/* Cards sort by profile; phones may not have shown the sidebar that detects them. */}
      <CodeProfileProbes projects={projects} />
      {/* The cards stay one column wide (narrower than two 24rem cards); the manager gets the rest. */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,min(40%,36rem))_minmax(0,1fr)]">
        {/* Home has its own canvas so the cards read as one board, apart from thread views. */}
        <div className="flex min-h-0 min-w-0 flex-col bg-muted/40" data-home-dashboard="">
          <WorkspacePageHeader
            electron={isElectron}
            reserveNativeControls={false}
            // Home covers the sidebar, so its header clears the window controls itself.
            className="pl-(--home-header-start)"
          >
            <CompassIcon className="size-4 text-muted-foreground" aria-hidden />
            <h1 className="font-medium text-sm">Home</h1>
            <ManagerProfileSwitcher includeAll onSelect={selectManagerProfile} />
            <span className="hidden min-w-0 truncate text-muted-foreground text-xs sm:inline">
              {overview.needsMe.length} need you · {overview.working.length} working ·{" "}
              {overview.review.length} to review
            </span>
            {/* Narrow windows have no docked manager; this opens it as a page. */}
            <Button
              size="xs"
              variant="outline"
              className="ms-auto lg:hidden"
              data-home-open-manager=""
              onClick={() => void openManagerThreadPage(managerProfile)}
            >
              <MessagesSquareIcon />
              {managerProfile === null ? "Manager" : `${managerProfile} manager`}
            </Button>
          </WorkspacePageHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-(--workspace-gutter-start) pb-10">
            <VerdictBanner verdict={verdict} />
            {CARD_GROUPS.map(({ group, title }) =>
              overview[group].length === 0 ? null : (
                <section key={group} aria-label={title} data-work-group={group} className="mt-6">
                  <SectionTitle title={title} count={overview[group].length} />
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-3">
                    {overview[group].map((item) => (
                      <WorkCard
                        key={`${item.thread.environmentId}:${item.thread.id}`}
                        item={item}
                        now={now}
                        primaryEnvironmentId={primaryEnvironmentId}
                      />
                    ))}
                  </div>
                </section>
              ),
            )}
            {overview.done.length > 0 ? (
              <section aria-label="Recently done" data-work-group="done" className="mt-6">
                <SectionTitle title="Recently done" count={overview.done.length} />
                <ul className="divide-y rounded-xl border bg-card">
                  {overview.done.map((item) => (
                    <DoneRow
                      key={`${item.thread.environmentId}:${item.thread.id}`}
                      item={item}
                      now={now}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            <section aria-label="Goals" data-work-group="goals" className="mt-6">
              <SectionTitle title="Goals" count={goals.length} />
              {goals.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No open goals. Ask the manager to plan one.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
                  {goals.map((goal) => (
                    <GoalCard key={goal.key} goal={goal} environmentId={managerEnvironmentId} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
        <ManagerPane manager={manager} />
      </div>
    </div>
  );
}

function SectionTitle(props: { readonly title: string; readonly count: number }) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 font-medium text-sm">
      {props.title}
      {props.count > 0 ? (
        <span className="text-muted-foreground text-xs tabular-nums">{props.count}</span>
      ) : null}
    </h2>
  );
}

function VerdictBanner(props: { readonly verdict: Verdict }) {
  const look = VERDICT_LOOK[props.verdict.tone];
  return (
    <div
      className={cn(
        "mt-3 rounded-xl border bg-linear-to-r to-60% to-card px-4 py-3 text-base",
        look.bar,
      )}
      data-home-verdict={props.verdict.tone}
    >
      <b className={cn("font-semibold", look.lead)}>{props.verdict.lead}</b>{" "}
      <span>{props.verdict.detail}</span>
    </div>
  );
}

/** The manager thread docked beside the cards, as the real thread view. */
function ManagerPane(props: { readonly manager: ReturnType<typeof useEnsureManagerThread> }) {
  const { manager } = props;
  return (
    <section
      aria-label="Manager"
      data-home-manager=""
      className="hidden min-h-0 min-w-0 flex-col border-s lg:flex"
    >
      {manager._tag === "Ready" ? (
        <ChatView
          key={`${manager.environmentId}:${manager.threadId}`}
          environmentId={manager.environmentId}
          threadId={manager.threadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
        />
      ) : manager._tag === "Failed" ? (
        <p className="m-4 text-destructive-foreground text-sm">{manager.message}</p>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      )}
    </section>
  );
}

function WorkCard(props: {
  readonly item: WorkItem<EnvironmentThreadShell>;
  readonly now: number;
  readonly primaryEnvironmentId: EnvironmentId | null;
}) {
  const { thread, reason, lastActivityAt } = props.item;
  const look = WORK_REASON_LOOK[reason];
  const projects = useProjects();
  const projectTitle =
    projects.find(
      (project) =>
        project.environmentId === thread.environmentId && project.id === thread.projectId,
    )?.title ?? null;
  const profile = useSpaceStore(
    (state) =>
      state.detectedProfileByProjectKey[`${thread.environmentId}:${thread.projectId}`] ?? null,
  );
  const environment = useEnvironment(thread.environmentId);
  const machine =
    props.primaryEnvironmentId !== null && thread.environmentId !== props.primaryEnvironmentId
      ? (environment?.label ?? "another machine")
      : null;
  const { digest, tryUrls, pullRequests } = useThreadReport(thread);

  return (
    <article
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-4 text-card-foreground"
      data-work-thread={thread.id}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", look.dot)} />
        <h3 className="min-w-0 flex-1 truncate font-semibold text-base">{thread.title}</h3>
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {relativeLabel(lastActivityAt, props.now)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
        <span
          className={cn(
            reason === "failed" || reason === "limited" ? "text-destructive-foreground" : "",
          )}
        >
          {look.label}
        </span>
        {projectTitle ? <span>· {projectTitle}</span> : null}
        {profile ? (
          <Badge variant="outline" size="sm">
            {profile}
          </Badge>
        ) : null}
        {machine ? (
          <Badge variant="secondary" size="sm">
            {machine}
          </Badge>
        ) : null}
      </div>
      <ThreadReportLinks tryUrls={tryUrls} pullRequests={pullRequests}>
        <Button
          size="sm"
          variant="outline"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId: thread.environmentId, threadId: thread.id }}
            />
          }
        >
          <MessagesSquareIcon />
          Open thread
        </Button>
      </ThreadReportLinks>
      <ThreadReportBody environmentId={thread.environmentId} threadId={thread.id} digest={digest} />
      {thread.branch ? (
        <p className="truncate font-mono text-muted-foreground text-xs">{thread.branch}</p>
      ) : null}
    </article>
  );
}

function DoneRow(props: { readonly item: WorkItem<EnvironmentThreadShell>; readonly now: number }) {
  const { thread, lastActivityAt } = props.item;
  return (
    <li
      className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm"
      data-work-thread={thread.id}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", WORK_REASON_LOOK.settled.dot)}
      />
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {thread.title}
      </Link>
      {thread.branch ? (
        <span className="hidden min-w-0 max-w-56 truncate font-mono text-muted-foreground text-xs sm:inline">
          {thread.branch}
        </span>
      ) : null}
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {relativeLabel(lastActivityAt, props.now)}
      </span>
    </li>
  );
}

function GoalCard(props: {
  readonly goal: BoardGoal;
  readonly environmentId: EnvironmentId | null;
}) {
  const { goal } = props;
  const doneCount = goal.tasks.filter((task) => task.done).length;
  const total = goal.tasks.length;
  const openTasks = goal.tasks.filter((task) => !task.done);
  return (
    <article
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4"
      data-goal={goal.title}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-semibold">{goal.title}</h3>
        <span className="shrink-0 text-muted-foreground text-xs">{goal.spaceName}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
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
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {doneCount}/{total}
        </span>
      </div>
      {openTasks.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground text-sm">
          {openTasks.slice(0, OPEN_TASKS_SHOWN).map((task) => (
            <li key={`${task.number}:${task.title}`} className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate">{task.title}</span>
              {props.environmentId !== null && task.threadIds[0] ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: props.environmentId, threadId: task.threadIds[0] }}
                  className="shrink-0 text-xs hover:text-foreground"
                >
                  thread
                </Link>
              ) : null}
            </li>
          ))}
          {openTasks.length > OPEN_TASKS_SHOWN ? (
            <li className="text-xs">{openTasks.length - OPEN_TASKS_SHOWN} more open</li>
          ) : null}
        </ul>
      ) : null}
    </article>
  );
}

function relativeLabel(iso: string, now: number): string {
  const elapsedMs = now - Date.parse(iso);
  if (Number.isNaN(elapsedMs)) return "";
  return elapsedMs < 60_000 ? "just now" : formatRelativeTimeLabel(iso);
}
