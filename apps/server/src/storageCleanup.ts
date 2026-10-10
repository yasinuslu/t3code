import {
  CommandId,
  isProviderNativeSubagentThread,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProviderSessionJson,
  WorktreeFinishError,
  type ThreadId,
  type WorktreeFinishResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type {
  OrchestrationV2ThreadShell,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import { threadHasQueuedTurnStart } from "./orchestration-v2/ThreadSettlementService.ts";
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";

const decodeCleanupThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeCleanupSession = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);

const DAY_MS = 86_400_000;
const isWorktreeFinishError = Schema.is(WorktreeFinishError);

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeUnchanged;

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

const STORAGE_CLEANUP_IDLE_STATUSES = new Set<OrchestrationV2ThreadShell["status"]>([
  "idle",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/** Live sessions keep their cwd even when no turn is currently running. */
export function storageCleanupThreadIdle(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.branch !== null &&
    thread.worktreePath !== null &&
    thread.activeRunId === null &&
    // Shell status is the latest run status, so a thread whose last turn ended is idle too.
    STORAGE_CLEANUP_IDLE_STATUSES.has(thread.status) &&
    // Settling stops a thread's background work, so a roster entry left on a settled
    // thread is stale (a provider that never reported the command ending).
    ((thread.pendingBackgroundTasks?.length ?? 0) === 0 || thread.settledOverride === "settled") &&
    thread.pendingRuntimeRequest === null &&
    !threadHasQueuedTurnStart(thread, now)
  );
}

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt(thread: OrchestrationV2ThreadShell): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const hasTerminal = (worktreePath: string) =>
    [...liveTerminals.values()]
      .flatMap((entries) => [...entries.values()])
      .some((terminal) => {
        if (terminal.status !== "starting" && terminal.status !== "running") return false;
        const cwd = path.resolve(terminal.cwd);
        return (
          (terminal.worktreePath !== null &&
            path.resolve(terminal.worktreePath) === worktreePath) ||
          cwd === worktreePath ||
          inside(worktreePath, cwd)
        );
      });

  // Threads whose agent or user asked to finish them (`finish` below). Their
  // worktree is removed once the thread is idle, without waiting for a PR rule.
  const finishRequests = new Map<string, { readonly into: string | null }>();
  // Why the sweep last passed over a requested worktree, so `finish` can say what it waits for.
  const finishWaits = new Map<string, string>();
  let finishCommandCount = 0;
  const finishCommandId = (threadId: string, step: string) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) =>
        CommandId.make(`server:worktree-finish:${step}:${threadId}:${now}:${++finishCommandCount}`),
      ),
    );

  // The branch a thread's merged PR went into; null when no linked PR merged.
  const mergedPullRequestBase = (
    thread: Pick<OrchestrationV2ThreadShell, "branch" | "pullRequests">,
  ) =>
    visibleThreadPullRequests(thread.pullRequests ?? []).find(
      (link) => link.snapshot?.state === "merged" && link.snapshot.headBranch === thread.branch,
    )?.snapshot?.baseBranch ?? null;

  /** Whether `commit` is already part of `base` on the primary remote, fetched first. */
  const mergedInto = Effect.fn("StorageCleanup.mergedInto")(function* (input: {
    readonly repositoryCwd: string;
    readonly worktreePath: string;
    readonly commit: string;
    readonly base: string | null;
  }) {
    const remote = yield* git.resolvePrimaryRemoteName(input.repositoryCwd);
    const branch = input.base ?? (yield* git.resolveDefaultBranchName(input.repositoryCwd, remote));
    if (branch === null) return { merged: false, ref: `${remote}/<default branch>` };
    yield* git.fetchRemoteTrackingBranch({
      cwd: input.repositoryCwd,
      remoteName: remote,
      remoteBranch: branch,
    });
    const base = yield* git.resolveCommit({
      cwd: input.worktreePath,
      revision: `refs/remotes/${remote}/${branch}`,
    });
    const ancestor = yield* git.execute({
      operation: "StorageCleanup.integratedBranch",
      cwd: input.worktreePath,
      args: ["merge-base", "--is-ancestor", input.commit, base.commitSha],
      allowNonZeroExit: true,
    });
    return { merged: ancestor.exitCode === 0, ref: `${remote}/${branch}` };
  });

  /**
   * After a finished worktree is gone: the thread moves to the project root and
   * its branch goes away locally and on every remote that still has it (a push
   * mirror does not carry deletions).
   */
  const finishBranch = Effect.fn("StorageCleanup.finishBranch")(function* (input: {
    /** Null for a worktree no thread uses: nothing to move. */
    readonly threadId: ThreadId | null;
    readonly worktreePath: string;
    readonly branch: string;
    readonly workspaceRoot: string;
    readonly rebind: boolean;
  }) {
    if (input.rebind && input.threadId !== null) {
      yield* engine
        .dispatch({
          type: "thread.metadata.update",
          commandId: yield* finishCommandId(input.threadId, "rebind"),
          threadId: input.threadId,
          worktreePath: null,
          branch: null,
          expectedWorktreePath: input.worktreePath,
        })
        .pipe(
          Effect.catch((error) => Effect.logWarning("worktree finish rebind failed", { error })),
        );
    }
    yield* git
      .deleteLocalBranch({ cwd: input.workspaceRoot, refName: input.branch, force: true })
      .pipe(
        Effect.catch((error) => Effect.logDebug("worktree finish kept local branch", { error })),
      );
    const remotes = yield* git.execute({
      operation: "StorageCleanup.remotes",
      cwd: input.workspaceRoot,
      args: ["remote"],
    });
    for (const remote of remotes.stdout.split("\n").filter((name) => name.trim() !== "")) {
      const present = yield* git.execute({
        operation: "StorageCleanup.remoteBranch",
        cwd: input.workspaceRoot,
        args: ["ls-remote", "--exit-code", "--heads", remote, input.branch],
        allowNonZeroExit: true,
        timeoutMs: 30_000,
      });
      if (present.exitCode !== 0) continue;
      yield* git
        .execute({
          operation: "StorageCleanup.deleteRemoteBranch",
          cwd: input.workspaceRoot,
          args: ["push", remote, "--delete", input.branch],
          timeoutMs: 60_000,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("worktree finish could not delete remote branch", { remote, error }),
          ),
        );
    }
    yield* gitManager.invalidateStatus(input.workspaceRoot);
    yield* Effect.logInfo("worktree finish deleted branch", {
      threadId: input.threadId,
      branch: input.branch,
    });
  });

  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const active = yield* projections.getShellSnapshot();
    const archived = yield* projections.getShellSnapshot({ location: "archive" });
    const projects = yield* projectStore.listShells();
    // A provider subagent's thread inherits its parent's worktree. It is part of the
    // parent's work, not another thread using the checkout, so it never keeps it shared.
    const threads = [...active.threads, ...archived.threads].filter(
      (thread) => !isProviderNativeSubagentThread(thread),
    );
    return { projects, threads };
  });

  // Local threads under another project need not have a worktreePath of their own.
  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of projects) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (projectPath === worktreePath || inside(worktreePath, projectPath)) return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (realPath === worktreePath || inside(worktreePath, realPath)) return true;
    }
    return false;
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
  ) {
    if (!anyWorktreePolicy(serverSettings, worktreeCleanupEnabled) && finishRequests.size === 0)
      return;
    if (!(yield* fs.exists(config.worktreesDir))) return;
    const hasDeleteRule = anyWorktreePolicy(serverSettings, (rules) => rules.worktreeOnDelete);
    const deletedRows = hasDeleteRule
      ? yield* sql<{ payload_json: string; workspaceRoot: string }>`
          SELECT t.payload_json, p.workspace_root AS "workspaceRoot"
          FROM orchestration_v2_projection_threads t
          JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.deleted_at IS NOT NULL
        `
      : [];
    const deletedThreads = (yield* Effect.forEach(deletedRows, (row) =>
      decodeCleanupThread(row.payload_json).pipe(
        Effect.map((thread) => ({ ...thread, workspaceRoot: row.workspaceRoot })),
      ),
    )).filter(
      (thread) =>
        thread.worktreePath !== null &&
        thread.branch !== null &&
        resolveWorktreeCleanup(serverSettings, thread.projectId).worktreeOnDelete,
    );
    const snapshot = yield* readThreads();
    const root = yield* fs.realPath(config.worktreesDir);
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    const candidates = [
      ...[...groups.values()].flatMap((group) => (group.length === 1 ? [group[0]!] : [])),
      ...deletedThreads.filter((thread) => !groups.has(path.resolve(thread.worktreePath!))),
    ];
    for (const thread of candidates) {
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      const requested = finishRequests.get(thread.id);
      if (!worktreeCleanupEnabled(settings) && requested === undefined) continue;
      const wait = (reason: string) =>
        Effect.sync(() => {
          if (requested !== undefined) finishWaits.set(thread.id, reason);
        });
      const worktreePath = path.resolve(thread.worktreePath!);
      const deleted = "workspaceRoot" in thread;
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (project === undefined) continue;
      if (!deleted && !storageCleanupThreadIdle(thread, now)) {
        yield* wait("the thread is still busy (a turn, a queued message or background work)");
        continue;
      }
      if (hasTerminal(worktreePath)) {
        yield* wait("a terminal is still open in the worktree");
        continue;
      }
      yield* Effect.gen(function* () {
        if (!inside(root, worktreePath) || !(yield* fs.exists(worktreePath))) return;
        if ((yield* fs.realPath(worktreePath)) !== worktreePath) return;
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects])) {
          return yield* wait("a project lives inside the worktree");
        }
        // A linked worktree has a .git file. Never remove a main checkout.
        if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File") return;
        const status = yield* git.statusDetailsLocal(worktreePath);
        if (!status.isRepo || status.branch !== thread.branch || status.hasWorkingTreeChanges) {
          return yield* wait("the worktree changed (uncommitted changes or another branch)");
        }
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        const ignored = yield* git.execute({
          operation: "StorageCleanup.ignoredFiles",
          cwd: worktreePath,
          args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          maxOutputBytes: 64 * 1024,
        });
        // Ignored files can contain secrets or local datasets. Dependency installs
        // are reproducible; every other ignored path prevents automatic removal,
        // unless the work is finished: asked for, or merged with branchOnMerge on.
        const keepsIgnoredFiles =
          ignored.stdoutTruncated ||
          ignored.stdout
            .split("\0")
            .some((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));
        const old =
          !deleted &&
          settings.worktreeAfterDays !== null &&
          storageCleanupActivityAt(thread) < now - settings.worktreeAfterDays * DAY_MS;
        let eligible = deleted || old;
        // Merged work: a linked PR that merged, a PR found for the branch, or a
        // finish request. The commit must be in the branch it merged into.
        let merged = false;
        if (
          !eligible &&
          (settings.worktreeUnchanged || settings.worktreeOnMerge || requested !== undefined)
        ) {
          const repositoryCwd = path.resolve(project.workspaceRoot);
          const linkedBase = settings.worktreeOnMerge ? mergedPullRequestBase(thread) : null;
          const base = requested?.into ?? linkedBase;
          const integrated = yield* mergedInto({
            repositoryCwd,
            worktreePath,
            commit: head.commitSha,
            base,
          });
          if (!integrated.merged) return yield* wait(`not merged into ${integrated.ref}`);
          merged = requested !== undefined || linkedBase !== null;
          eligible = settings.worktreeUnchanged || merged;
          if (!eligible && settings.worktreeOnMerge && thread.branch !== null) {
            const pullRequest = yield* gitManager.branchPullRequest(
              { cwd: worktreePath, branch: thread.branch },
              { refresh: true },
            );
            merged = eligible = pullRequest?.state === "merged";
          }
        }
        const finishing =
          requested !== undefined || (merged && serverSettings.storageCleanup.branchOnMerge);
        if (keepsIgnoredFiles && !finishing) return;
        if (!eligible) return;
        // Re-read after Git/host calls so a queued turn, resumed session or new
        // thread sharing this path cancels the removal.
        const latestSnapshot = yield* readThreads();
        if (yield* containsProjectRoot(worktreePath, [project, ...latestSnapshot.projects])) return;
        const latest = latestSnapshot.threads.filter(
          (entry) =>
            entry.worktreePath !== null && path.resolve(entry.worktreePath) === worktreePath,
        );
        if (hasTerminal(worktreePath))
          return yield* wait("a terminal is still open in the worktree");
        if (deleted) {
          if (
            latest.length > 0 ||
            !resolveWorktreeCleanup(yield* settingsService.getSettings, thread.projectId)
              .worktreeOnDelete
          )
            return;
          // V2 deletion queues durable cleanup. Do not remove its checkout until
          // every effect has finished successfully or was explicitly cancelled.
          const pendingCleanup = yield* sql`
            SELECT 1 FROM orchestration_v2_effect_outbox
            WHERE thread_id = ${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1
          `;
          if (pendingCleanup.length > 0) return;
        } else if (
          latest.length !== 1 ||
          latest[0]!.id !== thread.id ||
          !storageCleanupThreadIdle(latest[0]!, now) ||
          storageCleanupActivityAt(latest[0]!) !== storageCleanupActivityAt(thread)
        ) {
          return yield* wait(
            latest.length !== 1
              ? `${latest.length} threads use the worktree`
              : "the thread changed during the check",
          );
        }
        // Sessions can outlive their run and can be shared across app threads.
        const sessionRows = yield* sql<{ payload_json: string }>`
          SELECT payload_json FROM orchestration_v2_projection_provider_sessions
          WHERE status != 'stopped'
        `;
        const sessions = yield* Effect.forEach(sessionRows, (row) =>
          decodeCleanupSession(row.payload_json),
        );
        const worktreeSessions = sessions.filter((session) => {
          const cwd = path.resolve(session.cwd);
          return cwd === worktreePath || inside(worktreePath, cwd);
        });
        if (worktreeSessions.length > 0) {
          if (!finishing) return;
          // Finished work: settle a requested thread (which detaches its session),
          // then stop the idle session now instead of after its idle timeout.
          if (requested !== undefined && latest[0]?.settledOverride !== "settled") {
            yield* engine.dispatch({
              type: "thread.settle",
              commandId: yield* finishCommandId(thread.id, "settle"),
              threadId: thread.id,
            });
          }
          yield* Effect.forEach(
            worktreeSessions,
            (session) =>
              providerSessions.release({
                providerSessionId: session.id,
                reason: "manual_shutdown",
                detail: "The thread's worktree was finished.",
              }),
            { discard: true },
          );
        }
        const finalStatus = yield* git.statusDetailsLocal(worktreePath);
        if (
          !finalStatus.isRepo ||
          finalStatus.branch !== thread.branch ||
          finalStatus.hasWorkingTreeChanges
        )
          return;
        if (
          (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
          head.commitSha
        )
          return;
        const finalIgnored = yield* git.execute({
          operation: "StorageCleanup.ignoredFiles",
          cwd: worktreePath,
          args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          maxOutputBytes: 64 * 1024,
        });
        if (
          !finishing &&
          (finalIgnored.stdoutTruncated ||
            finalIgnored.stdout
              .split("\0")
              .some((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry)))
        )
          return;
        const current = resolveWorktreeCleanup(
          yield* settingsService.getSettings,
          thread.projectId,
        );
        if (
          Object.keys(settings).some(
            (key) =>
              current[key as keyof typeof settings] !== settings[key as keyof typeof settings],
          )
        )
          return;
        yield* git.removeWorktree({
          cwd: project.workspaceRoot,
          path: worktreePath,
          force: finishing && keepsIgnoredFiles,
        });
        yield* gitManager.invalidateStatus(project.workspaceRoot);
        yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id });
        finishRequests.delete(thread.id);
        finishWaits.delete(thread.id);
        // Unfinished work keeps branch and path: ProviderTurnStartService
        // recreates the checkout from that branch when the thread is resumed.
        // A finish request settles the thread, whose work is done.
        if (requested !== undefined && latest[0]?.settledOverride !== "settled") {
          yield* engine
            .dispatch({
              type: "thread.settle",
              commandId: yield* finishCommandId(thread.id, "settle"),
              threadId: thread.id,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("worktree finish settle failed", { error }),
              ),
            );
        }
        if (finishing && thread.branch !== null) {
          yield* finishBranch({
            threadId: thread.id,
            worktreePath: thread.worktreePath!,
            branch: thread.branch,
            workspaceRoot: project.workspaceRoot,
            rebind: !deleted,
          });
        }
      }).pipe(
        (effect) => withWorkspaceLease(worktreePath, effect),
        Effect.catch((error) =>
          Effect.logDebug("storage cleanup skipped worktree", { threadId: thread.id, error }),
        ),
      );
    }
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
  ) {
    if (days === null || !(yield* fs.exists(root))) return;
    const realRoot = yield* fs.realPath(root);
    if (realRoot !== path.resolve(root)) return;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
          }
        }
      }
    });
    yield* visit(realRoot);
  });

  const sweep = Effect.fn("StorageCleanup.sweep")(function* () {
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const now = yield* Clock.currentTimeMillis;
    yield* cleanWorktrees(serverSettings, now).pipe(
      Effect.catch((error) => Effect.logWarning("worktree cleanup failed", { error })),
    );
    yield* cleanFiles(
      config.browserArtifactsDir,
      settings.browserArtifactsAfterDays,
      now,
      false,
    ).pipe(
      Effect.catch((error) => Effect.logWarning("browser artifact cleanup failed", { error })),
    );
    yield* cleanFiles(config.logsDir, settings.logsAfterDays, now, true).pipe(
      Effect.catch((error) => Effect.logWarning("rotated log cleanup failed", { error })),
    );
  });
  const worker = yield* makeDrainableWorker(() =>
    sweep().pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Effect.logWarning("storage cleanup failed", { cause }),
      ),
    ),
  );

  const start = Effect.fn("StorageCleanup.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = engine.streamDomainEvents;
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* forkParked(
      worker
        .enqueue(undefined)
        .pipe(
          Effect.andThen(worker.drain),
          Effect.repeat(Schedule.spaced("1 hour")),
          Effect.asVoid,
        ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return worker.enqueue(undefined);
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        ((event.type === "thread.deleted" || event.type === "provider-session.updated") &&
          anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnDelete)) ||
        // A merged PR settles its thread; finished work waits for its turn to end.
        (event.type === "thread.settled" &&
          (anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnMerge) ||
            finishRequests.has(event.threadId))) ||
        (event.type === "run.updated" && finishRequests.has(event.threadId))
          ? worker.enqueue(undefined)
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Storage cleanup event stream failed", { cause }),
        ),
      ),
    );
  });
  /**
   * A T3 worktree that no thread uses (its thread was deleted, or it was made by hand): the
   * same checks as a thread's, then the worktree and its branch go, locally and on every remote.
   */
  const finishOrphan = Effect.fn("StorageCleanup.finishOrphan")(function* (
    worktreePath: string,
    into: string | null,
  ) {
    const refuse = (message: string) => Effect.fail(new WorktreeFinishError({ message }));
    const root = yield* fs.realPath(config.worktreesDir);
    if (!inside(root, worktreePath) || !(yield* fs.exists(worktreePath))) {
      return yield* refuse(`No thread works in ${worktreePath}, and it is not a T3 worktree.`);
    }
    // A linked worktree has a .git file. Never remove a main checkout.
    if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File") {
      return yield* refuse(`${worktreePath} is not a linked worktree.`);
    }
    const status = yield* git.statusDetailsLocal(worktreePath);
    const branch = status.branch;
    if (!status.isRepo || branch === null) {
      return yield* refuse(`${worktreePath} has no branch checked out.`);
    }
    if (status.hasWorkingTreeChanges) {
      return yield* refuse(
        `${worktreePath} has uncommitted changes. Commit or discard them first.`,
      );
    }
    if (hasTerminal(worktreePath)) {
      return yield* refuse(`A terminal is still open in ${worktreePath}.`);
    }
    const commonDir = yield* git.execute({
      operation: "StorageCleanup.commonDir",
      cwd: worktreePath,
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    });
    const workspaceRoot = path.dirname(commonDir.stdout.trim());
    const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
    const integrated = yield* mergedInto({
      repositoryCwd: workspaceRoot,
      worktreePath,
      commit: head.commitSha,
      base: into,
    });
    if (!integrated.merged) {
      return yield* refuse(`${branch} is not merged into ${integrated.ref}. Merge it first.`);
    }
    // Tracked files are clean and merged; ignored build output and installs go with it.
    yield* withWorkspaceLease(
      worktreePath,
      git.removeWorktree({ cwd: workspaceRoot, path: worktreePath, force: true }),
    );
    yield* gitManager.invalidateStatus(workspaceRoot);
    yield* finishBranch({ threadId: null, worktreePath, branch, workspaceRoot, rebind: false });
    return {
      status: "finished",
      message: `No thread used it. Worktree removed and branch ${branch} deleted.`,
    } satisfies WorktreeFinishResult;
  });

  /**
   * Finishes a thread's worktree on request (`nep finish`, an agent's last
   * step): refuses uncommitted changes and work not yet merged into `into`
   * (default: a merged PR's base, else the default branch). Once the thread is
   * idle it is settled, its worktree removed, the thread moved to the project
   * root, and its branch deleted locally and on every remote.
   */
  const finish = Effect.fn("StorageCleanup.finish")(
    function* (input: {
      readonly threadId: ThreadId | null;
      readonly worktreePath: string | null;
      readonly into: string | null;
      readonly minIdleMs: number | null;
    }) {
      const refuse = (message: string) => Effect.fail(new WorktreeFinishError({ message }));
      const snapshot = yield* readThreads();
      const requestedPath = input.worktreePath === null ? null : path.resolve(input.worktreePath);
      const matches = snapshot.threads.filter((entry) =>
        input.threadId !== null
          ? entry.id === input.threadId
          : entry.worktreePath !== null && path.resolve(entry.worktreePath) === requestedPath,
      );
      if (matches.length > 1) {
        return yield* refuse(
          `${requestedPath} is shared by ${matches.length} threads; finish one by thread id.`,
        );
      }
      const thread = matches[0];
      if (thread === undefined) {
        if (requestedPath === null) return yield* refuse(`Thread ${input.threadId} was not found.`);
        return yield* finishOrphan(requestedPath, input.into);
      }
      const project = snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (project === undefined) return yield* refuse("The thread's project was not found.");
      if (thread.worktreePath === null || thread.branch === null) {
        return {
          status: "no-worktree",
          message: "The thread already works in the project root.",
        } satisfies WorktreeFinishResult;
      }
      if (input.minIdleMs !== null && thread.settledOverride !== "settled") {
        const now = yield* Clock.currentTimeMillis;
        if (
          !storageCleanupThreadIdle(thread, now) ||
          storageCleanupActivityAt(thread) > now - input.minIdleMs
        ) {
          return yield* refuse("The thread is not settled and was active recently.");
        }
      }
      const worktreePath = path.resolve(thread.worktreePath);
      if (!(yield* fs.exists(worktreePath))) {
        if (thread.settledOverride !== "settled" && thread.activeRunId === null) {
          yield* engine.dispatch({
            type: "thread.settle",
            commandId: yield* finishCommandId(thread.id, "settle"),
            threadId: thread.id,
          });
        }
        yield* finishBranch({
          threadId: thread.id,
          worktreePath: thread.worktreePath,
          branch: thread.branch,
          workspaceRoot: project.workspaceRoot,
          rebind: true,
        });
        return {
          status: "finished",
          message: `The worktree was already gone; the thread now works in ${project.workspaceRoot}.`,
        } satisfies WorktreeFinishResult;
      }
      const status = yield* git.statusDetailsLocal(worktreePath);
      if (!status.isRepo || status.branch !== thread.branch) {
        return yield* refuse(`${worktreePath} is not on the thread's branch ${thread.branch}.`);
      }
      if (status.hasWorkingTreeChanges) {
        return yield* refuse(
          `${worktreePath} has uncommitted changes. Commit or discard them first.`,
        );
      }
      const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
      const integrated = yield* mergedInto({
        repositoryCwd: path.resolve(project.workspaceRoot),
        worktreePath,
        commit: head.commitSha,
        base: input.into ?? mergedPullRequestBase(thread),
      });
      if (!integrated.merged) {
        return yield* refuse(
          `${thread.branch} is not merged into ${integrated.ref}. Merge it (or its PR) first.`,
        );
      }
      finishRequests.set(thread.id, { into: input.into });
      yield* worker.enqueue(undefined);
      yield* worker.drain;
      // The settle a live session needs runs the sweep once more.
      yield* worker.drain;
      const waitingFor = finishWaits.get(thread.id);
      return finishRequests.has(thread.id)
        ? ({
            status: "scheduled",
            message: `Checks passed. The worktree is removed and the thread settled once ${
              waitingFor === undefined ? "its current turn ends" : `this clears: ${waitingFor}`
            }.`,
          } satisfies WorktreeFinishResult)
        : ({
            status: "finished",
            message: `Worktree removed, branch ${thread.branch} deleted, thread now in ${project.workspaceRoot}.`,
          } satisfies WorktreeFinishResult);
    },
    Effect.mapError((error) =>
      isWorktreeFinishError(error)
        ? error
        : new WorktreeFinishError({ message: `Finishing the worktree failed: ${error.message}` }),
    ),
  );

  return { start, drain: worker.drain, finish };
});

export class StorageCleanup extends Context.Service<StorageCleanup, Effect.Success<typeof make>>()(
  "t3/storageCleanup",
) {}

export const layer = Layer.effect(StorageCleanup, make);
