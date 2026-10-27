/**
 * PreviewEnvironmentService - brings a thread's preview environment up and down through the
 * `preview` commands the project declares in t3.json.
 *
 * `up` and `down` return as soon as the command is accepted. The command itself runs in a
 * detached fiber and reports through the thread's `previewEnvironment` state and its preview
 * links, so callers (Grow, MCP tools) poll nothing.
 *
 * @module PreviewEnvironmentService
 */
import {
  CommandId,
  THREAD_PREVIEW_ENVIRONMENT_NOTE_MAX_CHARS,
  type OrchestrationV2ThreadShell,
  type ThreadId,
  type ThreadPreviewEnvironmentStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import { lastUrl } from "./lastUrl.ts";

const COMMAND_TIMEOUT = "15 minutes";
const PREVIEW_LABEL = "Preview";

export class PreviewEnvironmentError extends Schema.TaggedError<PreviewEnvironmentError>()(
  "PreviewEnvironmentError",
  {
    reason: Schema.Literals(["thread-not-found", "no-preview-command", "unavailable"]),
    detail: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "thread-not-found":
        return "The thread was not found.";
      case "no-preview-command":
        return `This project has no ${this.detail ?? "up"} preview command in t3.json.`;
      case "unavailable":
        return "The preview environment could not be reached.";
    }
  }
}

export class PreviewEnvironmentService extends Context.Service<
  PreviewEnvironmentService,
  {
    /** Starts the thread's preview environment in the background. */
    readonly up: (threadId: ThreadId) => Effect.Effect<void, PreviewEnvironmentError>;
    /** Stops it in the background and unlinks the preview it linked. */
    readonly down: (threadId: ThreadId) => Effect.Effect<void, PreviewEnvironmentError>;
  }
>()("t3/previewEnvironment/PreviewEnvironmentService") {}

const lastLine = (...outputs: ReadonlyArray<string>): string | undefined => {
  for (const output of outputs) {
    const line = output
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .at(-1);
    if (line !== undefined) return line;
  }
  return undefined;
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const runner = yield* ProcessRunner.ProcessRunner;
  const crypto = yield* Crypto.Crypto;
  const newCommandId = () =>
    crypto.randomUUIDv4().pipe(
      Effect.orDie,
      Effect.map((id) => CommandId.make(`preview-env:${id}`)),
    );

  const unavailable = () => new PreviewEnvironmentError({ reason: "unavailable" });

  const setStatus = Effect.fn("PreviewEnvironmentService.setStatus")(function* (
    threadId: ThreadId,
    status: ThreadPreviewEnvironmentStatus,
    note?: string | undefined,
  ) {
    return yield* orchestrator.dispatch({
      type: "thread.preview-environment.set",
      commandId: yield* newCommandId(),
      threadId,
      status,
      ...(note === undefined
        ? {}
        : { note: note.slice(0, THREAD_PREVIEW_ENVIRONMENT_NOTE_MAX_CHARS) }),
    });
  });

  const resolve = Effect.fn("PreviewEnvironmentService.resolve")(function* (
    threadId: ThreadId,
    which: "up" | "down",
  ) {
    const shell = yield* orchestrator.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
    if (shell === null || shell.deletedAt !== null) {
      return yield* new PreviewEnvironmentError({ reason: "thread-not-found" });
    }
    const project = yield* projects.get(shell.projectId).pipe(Effect.mapError(unavailable));
    const cwd = shell.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
    if (cwd === undefined)
      return yield* new PreviewEnvironmentError({ reason: "thread-not-found" });
    const file = yield* loader.load(cwd);
    const command = Option.getOrUndefined(file)?.preview?.[which];
    if (command === undefined) {
      return yield* new PreviewEnvironmentError({ reason: "no-preview-command", detail: which });
    }
    return { shell, cwd, command };
  });

  const run = (shell: OrchestrationV2ThreadShell, cwd: string, command: string) =>
    runner.run({
      command: "sh",
      args: ["-c", command],
      cwd,
      timeout: COMMAND_TIMEOUT,
      timeoutBehavior: "timedOutResult",
      env: {
        ...process.env,
        T3_THREAD_ID: shell.id,
        ...(shell.branch === null ? {} : { T3_BRANCH: shell.branch }),
      },
    });

  const runUp = Effect.fn("PreviewEnvironmentService.runUp")(function* (
    shell: OrchestrationV2ThreadShell,
    cwd: string,
    command: string,
  ) {
    const result = yield* run(shell, cwd, command);
    if (result.timedOut || result.code !== 0) {
      yield* setStatus(
        shell.id,
        "failed",
        result.timedOut
          ? "The preview command timed out."
          : (lastLine(result.stderr, result.stdout) ?? "The preview command failed."),
      );
      return;
    }
    const url = lastUrl(result.stdout) ?? lastUrl(result.stderr);
    if (url === null) {
      yield* setStatus(shell.id, "failed", "The preview command printed no URL.");
      return;
    }
    yield* orchestrator.dispatch({
      type: "thread.preview-link.link",
      commandId: yield* newCommandId(),
      threadId: shell.id,
      url,
      label: PREVIEW_LABEL,
      source: "agent",
    });
    yield* setStatus(shell.id, "running", url);
  });

  const runDown = Effect.fn("PreviewEnvironmentService.runDown")(function* (
    shell: OrchestrationV2ThreadShell,
    cwd: string,
    command: string,
  ) {
    const result = yield* run(shell, cwd, command);
    if (result.timedOut || result.code !== 0) {
      yield* setStatus(
        shell.id,
        "failed",
        result.timedOut
          ? "The stop command timed out."
          : (lastLine(result.stderr, result.stdout) ?? "The stop command failed."),
      );
      return;
    }
    const latest = (yield* orchestrator.getThreadShell(shell.id)) ?? shell;
    for (const link of latest.previewLinks ?? []) {
      if (link.label !== PREVIEW_LABEL) continue;
      yield* orchestrator.dispatch({
        type: "thread.preview-link.unlink",
        commandId: yield* newCommandId(),
        threadId: shell.id,
        url: link.url,
      });
    }
    yield* setStatus(shell.id, "stopped");
  });

  /** Reports a crash of the background work as a failed environment instead of losing it. */
  const background = <E, R>(shell: OrchestrationV2ThreadShell, work: Effect.Effect<void, E, R>) =>
    work.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("preview environment command crashed", { cause }).pipe(
          Effect.andThen(
            setStatus(shell.id, "failed", "The preview command could not run.").pipe(Effect.ignore),
          ),
        ),
      ),
      Effect.forkDetach,
      Effect.asVoid,
    );

  const up: PreviewEnvironmentService["Service"]["up"] = Effect.fn("PreviewEnvironmentService.up")(
    function* (threadId) {
      const { shell, cwd, command } = yield* resolve(threadId, "up");
      yield* setStatus(threadId, "starting").pipe(Effect.mapError(unavailable));
      yield* background(shell, runUp(shell, cwd, command));
    },
  );

  const down: PreviewEnvironmentService["Service"]["down"] = Effect.fn(
    "PreviewEnvironmentService.down",
  )(function* (threadId) {
    const { shell, cwd, command } = yield* resolve(threadId, "down");
    yield* setStatus(threadId, "stopping").pipe(Effect.mapError(unavailable));
    yield* background(shell, runDown(shell, cwd, command));
  });

  return PreviewEnvironmentService.of({ up, down });
});

export const layer = Layer.effect(PreviewEnvironmentService, make);
