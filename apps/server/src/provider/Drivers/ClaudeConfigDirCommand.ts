/**
 * Per-project Claude config dir from a user command (`homePathCommand`).
 *
 * Some setups pick CLAUDE_CONFIG_DIR per project (a wrapper binary, a direnv
 * rule). Instead of guessing, the instance can name a shell command that
 * prints the dir for a project; T3 runs it in the project's workspace root and
 * launches the CLI with that dir as an explicit CLAUDE_CONFIG_DIR, so the
 * header, transcripts, skills and resume all agree on one dir.
 *
 * @module ClaudeConfigDirCommand
 */
import type { ClaudeSettings } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../../pathExpansion.ts";
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

export interface ClaudeConfigDirResolver {
  /** The dir for a project root, or `undefined` when the command failed. */
  readonly resolve: (projectRoot: string) => Effect.Effect<string | undefined>;
  readonly invalidate: Effect.Effect<void>;
}

/**
 * Build the per-instance resolver, or `undefined` when the instance does not
 * use a command (none set, or an explicit `homePath` wins). Successful results
 * are cached per project root for the life of the instance, which is rebuilt
 * whenever its settings change; failures are logged and retried next time.
 */
export const makeClaudeConfigDirResolver = Effect.fn("makeClaudeConfigDirResolver")(function* (
  config: Pick<ClaudeSettings, "homePath" | "homePathCommand">,
  environment?: NodeJS.ProcessEnv,
  options?: { readonly timeout?: Duration.Input | undefined },
): Effect.fn.Return<
  ClaudeConfigDirResolver | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const command = config.homePathCommand.trim();
  if (command.length === 0 || config.homePath.trim().length > 0) return undefined;
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
  return {
    resolve: (projectRoot) =>
      Cache.get(cache, projectRoot).pipe(
        Effect.catch((error: ClaudeConfigDirCommandError) =>
          Effect.logWarning("Claude config dir command failed; using the default dir", {
            error: error.message,
          }).pipe(Effect.as(undefined)),
        ),
      ),
    invalidate: Cache.invalidateAll(cache),
  };
});
