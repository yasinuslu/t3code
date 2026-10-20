/**
 * Makes sure Claude can find a session's transcript before T3 resumes it.
 *
 * The CLI looks for `<configDir>/projects/<sanitized cwd>/<session>.jsonl`
 * and fails the turn with "No conversation found" when it is not there. That
 * happens when the thread's cwd changed (its worktree was removed and the
 * thread moved to the project root) or the session runs under another config
 * dir than the one that wrote it. The transcript is usually still on disk, so
 * it is copied to where the CLI looks; only a transcript that is gone
 * everywhere makes the resume fail, and T3 then starts a fresh session.
 *
 * @module ClaudeResumeTranscript
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/** Claude's project dir names are capped; longer names get a hash suffix we cannot derive. */
const MAX_SANITIZED_LENGTH = 200;

/** The project dir name Claude derives from a cwd. */
export const claudeProjectDirName = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/gu, "-");

export type ClaudeResumeTranscriptStatus =
  | { readonly _tag: "present" }
  | { readonly _tag: "copied"; readonly from: string }
  | { readonly _tag: "missing" };

/**
 * Check that the CLI will find `sessionId` when it resumes in `cwd` with
 * `configDir`, copying the transcript (and its sidecar dir of tool results
 * and subagents) from another project dir or config dir when it is there.
 * When several copies exist, the most recently written one wins. The cwd is
 * resolved through symlinks first, like the CLI's own `process.cwd()`.
 * `searchConfigDirs` is only read when the transcript is not already in place.
 * Read errors count as "not found here"; a cwd too long to map to a dir name
 * is reported present, so the CLI keeps the final word.
 */
export const ensureClaudeResumeTranscript = Effect.fn("ensureClaudeResumeTranscript")(
  function* (input: {
    readonly configDir: string;
    readonly cwd: string;
    readonly sessionId: string;
    readonly searchConfigDirs?: Effect.Effect<ReadonlyArray<string>>;
  }): Effect.fn.Return<ClaudeResumeTranscriptStatus, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fileSystem.realPath(input.cwd).pipe(Effect.orElseSucceed(() => input.cwd));
    const dirName = claudeProjectDirName(cwd);
    if (dirName.length > MAX_SANITIZED_LENGTH) return { _tag: "present" };
    const fileName = `${input.sessionId}.jsonl`;
    const exists = (candidate: string) =>
      fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    const targetDir = path.join(input.configDir, "projects", dirName);
    const target = path.join(targetDir, fileName);
    if (yield* exists(target)) return { _tag: "present" };

    const searchConfigDirs = input.searchConfigDirs ? yield* input.searchConfigDirs : [];
    const configDirs = [
      ...new Set([input.configDir, ...searchConfigDirs].map((dir) => path.resolve(dir))),
    ];
    const candidates: Array<{ readonly projectDir: string; readonly mtime: number }> = [];
    for (const configDir of configDirs) {
      const projectsDir = path.join(configDir, "projects");
      const projectDirs = yield* fileSystem
        .readDirectory(projectsDir)
        .pipe(Effect.orElseSucceed(() => [] as Array<string>));
      for (const projectDir of projectDirs) {
        const source = path.join(projectsDir, projectDir, fileName);
        if (source === target) continue;
        const info = yield* fileSystem.stat(source).pipe(Effect.option);
        if (info._tag === "None") continue;
        candidates.push({
          projectDir: path.join(projectsDir, projectDir),
          mtime: Option.match(info.value.mtime, {
            onNone: () => 0,
            onSome: (date) => date.getTime(),
          }),
        });
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const candidate of candidates) {
      const source = path.join(candidate.projectDir, fileName);
      const copied = yield* Effect.gen(function* () {
        yield* fileSystem.makeDirectory(targetDir, { recursive: true });
        yield* fileSystem.copyFile(source, target);
        const sidecar = path.join(candidate.projectDir, input.sessionId);
        if (yield* exists(sidecar)) {
          yield* fileSystem.copy(sidecar, path.join(targetDir, input.sessionId), {
            overwrite: false,
          });
        }
        return true;
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not copy a Claude transcript for resume", {
            source,
            target,
            error: String(error),
          }).pipe(Effect.andThen(exists(target))),
        ),
      );
      if (copied) return { _tag: "copied", from: source };
    }
    return { _tag: "missing" };
  },
);
