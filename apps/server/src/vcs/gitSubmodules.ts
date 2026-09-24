import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface GitSubmodule {
  /** Path relative to the root repository, `/`-separated, as Git prints it in root-level output. */
  readonly path: string;
  /** Absolute working directory of the submodule. */
  readonly cwd: string;
}

/**
 * Lists the initialized submodules below `rootCwd`, recursively, parents before children.
 * A submodule counts as initialized when its path holds a `.git` file or directory.
 *
 * `rootCwd` must be the repository top level, where `.gitmodules` lives. Repositories without
 * a `.gitmodules` file cost one file-exists check. `runGit` runs `git` in the given directory
 * and must tolerate a non-zero exit (`git config --get-regexp` exits 1 when nothing matches).
 * Discovery is best effort: unreadable levels contribute no submodules instead of failing.
 */
export const listInitializedSubmodules = <E, R>(
  rootCwd: string,
  runGit: (
    cwd: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<{ readonly stdout: string }, E, R>,
): Effect.Effect<ReadonlyArray<GitSubmodule>, never, FileSystem.FileSystem | Path.Path | R> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exists = (target: string) =>
      fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
    const submodules: GitSubmodule[] = [];

    const visit = (cwd: string, prefix: string): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        const gitmodules = path.join(cwd, ".gitmodules");
        if (!(yield* exists(gitmodules))) return;
        const result = yield* runGit(cwd, [
          "config",
          "-f",
          gitmodules,
          "-z",
          "--get-regexp",
          "^submodule\\..*\\.path$",
        ]).pipe(Effect.orElseSucceed(() => ({ stdout: "" })));
        for (const record of result.stdout.split("\0")) {
          const newline = record.indexOf("\n");
          if (newline < 0) continue;
          const relativePath = record.slice(newline + 1).replace(/\/+$/, "");
          // A hostile .gitmodules must not point checkpoint writes outside the repository.
          const segments = relativePath.split("/");
          if (
            relativePath.length === 0 ||
            path.isAbsolute(relativePath) ||
            segments.some((segment) => segment === "" || segment === "." || segment === "..")
          ) {
            continue;
          }
          const submoduleCwd = path.join(cwd, ...segments);
          if (!(yield* exists(path.join(submoduleCwd, ".git")))) continue;
          const submodulePath = prefix.length > 0 ? `${prefix}/${relativePath}` : relativePath;
          submodules.push({ path: submodulePath, cwd: submoduleCwd });
          yield* visit(submoduleCwd, submodulePath);
        }
      });

    yield* visit(rootCwd, "");
    return submodules;
  }).pipe(Effect.withSpan("listInitializedSubmodules"));
