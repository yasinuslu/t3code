/**
 * The CLI resumes only from `<configDir>/projects/<sanitized cwd>/<id>.jsonl`, so a
 * transcript under another cwd or config dir is copied there first; one that is
 * gone everywhere is reported missing so T3 starts a fresh, summarized session.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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
 * Copies the transcript and its sidecar dir (tool results, subagents) when found
 * elsewhere. Read errors count as "not here"; a cwd too long to map is reported
 * present, so the CLI keeps the final word.
 */
export const ensureClaudeResumeTranscript = Effect.fn("ensureClaudeResumeTranscript")(
  function* (input: {
    readonly configDir: string;
    readonly cwd: string;
    readonly sessionId: string;
    readonly searchConfigDirs?: ReadonlyArray<string>;
  }): Effect.fn.Return<ClaudeResumeTranscriptStatus, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dirName = claudeProjectDirName(input.cwd);
    if (dirName.length > MAX_SANITIZED_LENGTH) return { _tag: "present" };
    const fileName = `${input.sessionId}.jsonl`;
    const exists = (candidate: string) =>
      fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    const targetDir = path.join(input.configDir, "projects", dirName);
    const target = path.join(targetDir, fileName);
    if (yield* exists(target)) return { _tag: "present" };

    const configDirs = [
      ...new Set(
        [input.configDir, ...(input.searchConfigDirs ?? [])].map((dir) => path.resolve(dir)),
      ),
    ];
    for (const configDir of configDirs) {
      const projectsDir = path.join(configDir, "projects");
      const projectDirs = yield* fileSystem
        .readDirectory(projectsDir)
        .pipe(Effect.orElseSucceed(() => [] as Array<string>));
      for (const projectDir of projectDirs) {
        const source = path.join(projectsDir, projectDir, fileName);
        if (source === target || !(yield* exists(source))) continue;
        const copied = yield* Effect.gen(function* () {
          yield* fileSystem.makeDirectory(targetDir, { recursive: true });
          yield* fileSystem.copyFile(source, target);
          const sidecar = path.join(projectsDir, projectDir, input.sessionId);
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
    }
    return { _tag: "missing" };
  },
);
