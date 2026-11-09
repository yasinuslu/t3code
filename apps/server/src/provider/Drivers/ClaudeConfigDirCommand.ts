/**
 * Per-workspace Claude config dir: the workspace's code profile dir, else the
 * output of `homePathCommand` run in the project root, passed to the CLI as
 * an explicit CLAUDE_CONFIG_DIR.
 * @module ClaudeConfigDirCommand
 */
import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { type ProfileMismatch, profileMismatch } from "@t3tools/shared/profileGuard";
import type { CodeProfiles } from "../CodeProfiles.ts";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";

const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const DEFAULT_TIMEOUT = Duration.seconds(3);
const MAX_CACHED_PROJECTS = 64;

// @effect-diagnostics-next-line preferSchemaTaggedError:off - never crosses the wire.
export class ClaudeConfigDirCommandError extends Data.TaggedError("ClaudeConfigDirCommandError")<{
  readonly command: string;
  readonly cwd: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `Config dir command ${quote(this.command)} failed in ${this.cwd}: ${this.detail}`;
  }
}

/**
 * Run `command` through the shell in `cwd` and return the absolute dir it
 * printed (`~` expanded). A non-zero exit, a timeout, or output that is not a
 * single absolute path fails rather than guessing.
 */
export const runClaudeConfigDirCommand = Effect.fn("runClaudeConfigDirCommand")(function* (input: {
  readonly command: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly timeout?: Duration.Input | undefined;
}): Effect.fn.Return<
  string,
  ClaudeConfigDirCommandError,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const path = yield* Path.Path;
  const fail = (detail: string) =>
    new ClaudeConfigDirCommandError({ command: input.command, cwd: input.cwd, detail });
  const result = yield* spawnAndCollect(
    input.command,
    ChildProcess.make(input.command, [], {
      cwd: input.cwd,
      shell: true,
      ...(input.environment ? { env: input.environment } : {}),
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: input.timeout ?? DEFAULT_TIMEOUT,
      orElse: () => Effect.fail(fail("timed out")),
    }),
    Effect.mapError((cause) =>
      cause instanceof ClaudeConfigDirCommandError ? cause : fail(String(cause)),
    ),
  );
  if (result.code !== 0) {
    return yield* fail(`exited with ${result.code}: ${result.stderr.trim().slice(0, 500)}`);
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  const printed = lines.length === 1 ? expandHomePath(lines[0]!.trim(), NodeOS.homedir()) : "";
  if (printed.length === 0 || !path.isAbsolute(printed)) {
    return yield* fail(`expected one absolute path, got ${quote(result.stdout.trim())}`);
  }
  return path.resolve(printed);
});

/**
 * The main checkout of the repository `cwd` is in (worktrees live outside the
 * project, so path-based commands must run in the main checkout). `undefined`
 * without a repository, in a submodule, or without git.
 */
export const resolveMainCheckoutRoot = Effect.fn("resolveMainCheckoutRoot")(function* (
  cwd: string,
): Effect.fn.Return<
  string | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const path = yield* Path.Path;
  const result = yield* spawnAndCollect(
    "git",
    ChildProcess.make("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }),
  ).pipe(
    Effect.timeoutOrElse({ duration: DEFAULT_TIMEOUT, orElse: () => Effect.void }),
    Effect.orElseSucceed(() => undefined),
  );
  if (result === undefined || result.code !== 0) return undefined;
  const commonDir = result.stdout.trim();
  return /[\\/]\.git$/u.test(commonDir) ? path.dirname(commonDir) : undefined;
});

export interface ResolvedClaudeConfigDir {
  readonly path: string;
  /** The code profile the workspace belongs to, when one matched. */
  readonly profile?: string;
  /**
   * Set when the instance's own `homePath` belongs to another code profile
   * than the workspace: a session there would run on the wrong profile's
   * login, settings and memory, so callers refuse it.
   */
  readonly profileMismatch?: ProfileMismatch;
  /** With `profileMismatch`: the workspace profile's own Claude dir, if it names one. */
  readonly workspaceProfileDir?: string;
}

export interface ClaudeConfigDirResolver {
  /**
   * The dir for `cwd`, or `undefined` to keep the instance's own: its
   * `homePath` (flagged when it belongs to another profile), the code profile
   * dir, then the command output (run in `projectRoot` or the main checkout).
   */
  readonly resolveForWorkspace: (
    cwd: string,
    projectRoot?: string | undefined,
  ) => Effect.Effect<ResolvedClaudeConfigDir | undefined>;
  readonly invalidate: Effect.Effect<void>;
}

/**
 * The per-instance resolver, or `undefined` when nothing picks a dir per
 * workspace. Command results are cached per project root until the instance
 * is rebuilt; failures are retried next time.
 */
export const makeClaudeConfigDirResolver = Effect.fn("makeClaudeConfigDirResolver")(function* (
  config: Pick<ClaudeSettings, "homePath" | "homePathCommand">,
  environment?: NodeJS.ProcessEnv,
  options?: {
    readonly timeout?: Duration.Input | undefined;
    readonly codeProfiles?: CodeProfiles["Service"] | undefined;
  },
): Effect.fn.Return<
  ClaudeConfigDirResolver | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const homePath = config.homePath.trim();
  const command = homePath.length > 0 ? "" : config.homePathCommand.trim();
  const codeProfiles = options?.codeProfiles;
  if (command.length === 0 && codeProfiles === undefined) return undefined;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const cache = yield* Cache.makeWith(
    (projectRoot: string) =>
      runClaudeConfigDirCommand({
        command,
        cwd: projectRoot,
        environment,
        timeout: options?.timeout,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Path.Path, path),
      ),
    {
      capacity: MAX_CACHED_PROJECTS,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    },
  );
  const runCommand = Effect.fn("ClaudeConfigDirResolver.runCommand")(function* (
    cwd: string,
    projectRoot: string | undefined,
  ) {
    if (command.length === 0) return undefined;
    const root =
      projectRoot ??
      (yield* resolveMainCheckoutRoot(cwd).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Path.Path, path),
      )) ??
      cwd;
    return yield* Cache.get(cache, root).pipe(
      Effect.catch((error: ClaudeConfigDirCommandError) =>
        Effect.logWarning("Claude config dir command failed; using the default dir", {
          error: error.message,
        }).pipe(Effect.as(undefined)),
      ),
    );
  });
  return {
    resolveForWorkspace: Effect.fn("ClaudeConfigDirResolver.resolveForWorkspace")(function* (
      cwd: string,
      projectRoot?: string | undefined,
    ) {
      const profile = codeProfiles
        ? yield* codeProfiles.resolve(projectRoot ?? cwd, environment)
        : undefined;
      const label = profile ? { profile: profile.name } : {};
      if (homePath.length > 0) {
        const instanceDir = path.resolve(expandHomePath(homePath, NodeOS.homedir()));
        const mismatch = codeProfiles
          ? profileMismatch(
              yield* codeProfiles.profileOf(instanceDir),
              yield* codeProfiles.profileOf(projectRoot ?? cwd),
            )
          : undefined;
        if (mismatch !== undefined) {
          return {
            path: instanceDir,
            profile: mismatch.workspaceProfile,
            profileMismatch: mismatch,
            ...(profile?.name === mismatch.workspaceProfile && profile.claudeConfigDir
              ? { workspaceProfileDir: profile.claudeConfigDir }
              : {}),
          };
        }
        return profile ? { path: instanceDir, ...label } : undefined;
      }
      if (profile?.claudeConfigDir !== undefined) {
        return { path: profile.claudeConfigDir, ...label };
      }
      const commandDir = yield* runCommand(cwd, projectRoot);
      if (commandDir !== undefined) return { path: commandDir, ...label };
      if (profile === undefined) return undefined;
      // A profile without its own Claude dir still labels the workspace.
      const inherited = environment?.CLAUDE_CONFIG_DIR?.trim();
      return {
        path: inherited ? path.resolve(inherited) : path.join(NodeOS.homedir(), ".claude"),
        ...label,
      };
    }),
    invalidate: Cache.invalidateAll(cache),
  };
});
