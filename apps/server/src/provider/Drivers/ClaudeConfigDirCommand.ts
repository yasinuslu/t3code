/**
 * Per-workspace Claude config dir, from the workspace's code profile
 * (`settings.codeProfiles`) or a user command (`homePathCommand`).
 *
 * Some setups pick CLAUDE_CONFIG_DIR per project (a wrapper binary, a direnv
 * rule). Instead of guessing, the instance can name a shell command that
 * prints the dir for a project; T3 runs it in the project's workspace root and
 * launches the CLI with that dir as an explicit CLAUDE_CONFIG_DIR, so the
 * header, transcripts, skills and resume all agree on one dir. A code profile
 * names the dir directly and wins over the command.
 *
 * @module ClaudeConfigDirCommand
 */
import * as NodeOS from "node:os";

import type { ClaudeSettings, CodeProfileClaudeLogin } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../../pathExpansion.ts";
import { claudeProfileEnvironment, type ClaudeProfileLogins } from "../ClaudeProfileLogins.ts";
import type { CodeProfiles } from "../CodeProfiles.ts";
import { spawnAndCollect } from "../providerSnapshot.ts";

const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const DEFAULT_TIMEOUT = Duration.seconds(3);
const MAX_CACHED_PROJECTS = 64;

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
  const printed = lines.length === 1 ? expandHomePath(lines[0]!.trim()) : "";
  if (printed.length === 0 || !path.isAbsolute(printed)) {
    return yield* fail(`expected one absolute path, got ${quote(result.stdout.trim())}`);
  }
  return path.resolve(printed);
});

/**
 * The main checkout of the repository `cwd` belongs to, when `cwd` is inside a
 * linked worktree or the main checkout itself. Worktrees usually live outside
 * the project (`~/.t3/worktrees/...`), so a command that picks the dir from
 * the path must run in the main checkout to see the project's location.
 * `undefined` for anything else (no repository, a submodule, git missing).
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
    Effect.timeoutOrElse({ duration: DEFAULT_TIMEOUT, orElse: () => Effect.succeed(undefined) }),
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
  /** `path` is the profile's own home, so the profile's login applies. */
  readonly profileHome?: true;
  /** The profile's active token login; absent for the home login. */
  readonly login?: CodeProfileClaudeLogin;
}

export interface ClaudeConfigDirResolver {
  /**
   * The dir for a session or workspace in `cwd`, or `undefined` to keep the
   * instance's own dir. In order: the instance's `homePath` (still labelled
   * with the workspace's code profile), the code profile's Claude dir, then
   * the `homePathCommand` output. The command runs in `projectRoot` when
   * given, otherwise in the main checkout of the repository `cwd` is in (so a
   * worktree resolves like its project), otherwise in `cwd`.
   */
  readonly resolveForWorkspace: (
    cwd: string,
    projectRoot?: string | undefined,
  ) => Effect.Effect<ResolvedClaudeConfigDir | undefined>;
  readonly invalidate: Effect.Effect<void>;
  /**
   * `base` with the resolved dir, plus the profile's login: its token as
   * CLAUDE_CODE_OAUTH_TOKEN, or no inherited token for the home login.
   */
  readonly environmentFor: (
    resolved: ResolvedClaudeConfigDir | undefined,
    base: NodeJS.ProcessEnv,
  ) => Effect.Effect<NodeJS.ProcessEnv>;
}

/**
 * Build the per-instance resolver, or `undefined` when nothing can pick a dir
 * per workspace (no code profiles service and no command, or an explicit
 * `homePath` without profiles). Command results are cached per project root
 * for the life of the instance, which is rebuilt whenever its settings
 * change; failures are logged and retried next time.
 */
export const makeClaudeConfigDirResolver = Effect.fn("makeClaudeConfigDirResolver")(function* (
  config: Pick<ClaudeSettings, "homePath" | "homePathCommand">,
  environment?: NodeJS.ProcessEnv,
  options?: {
    readonly timeout?: Duration.Input | undefined;
    readonly codeProfiles?: CodeProfiles["Service"] | undefined;
    readonly logins?: ClaudeProfileLogins["Service"] | undefined;
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
        return profile ? { path: path.resolve(expandHomePath(homePath)), ...label } : undefined;
      }
      if (profile?.claudeConfigDir !== undefined) {
        return {
          path: profile.claudeConfigDir,
          ...label,
          profileHome: true as const,
          ...(profile.claudeLogin ? { login: profile.claudeLogin } : {}),
        };
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
    environmentFor: Effect.fn("ClaudeConfigDirResolver.environmentFor")(function* (
      resolved: ResolvedClaudeConfigDir | undefined,
      base: NodeJS.ProcessEnv,
    ) {
      if (resolved === undefined) return base;
      const stored =
        resolved.login && options?.logins
          ? Option.getOrUndefined(yield* options.logins.read(resolved.login.id))
          : undefined;
      if (resolved.login && !stored) {
        yield* Effect.logWarning("Claude login token is missing; using the profile's home login", {
          profile: resolved.profile,
          login: resolved.login.name,
        });
      }
      return claudeProfileEnvironment(base, {
        configDir: resolved.path,
        profiled: resolved.profileHome === true,
        ...(stored ? { token: stored.token } : {}),
      });
    }),
  };
});
