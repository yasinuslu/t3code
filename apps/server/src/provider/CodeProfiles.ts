/**
 * CodeProfiles - which code profile (`settings.codeProfiles`) a folder belongs
 * to, and the Claude config dir sessions there use.
 *
 * A folder belongs to the profile whose `root` contains its physical path
 * (symlinks resolved; the deepest root wins). A git worktree outside every
 * root, such as T3's own under `~/.t3/worktrees`, belongs to the profile of
 * its main checkout. A folder that matches no profile resolves to
 * `undefined`, which leaves the dir to the instance as before.
 *
 * @module provider/CodeProfiles
 */
import type { CodeProfile } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePathWith } from "../pathExpansion.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveMainCheckoutRoot } from "./Drivers/ClaudeConfigDirCommand.ts";

export interface ResolvedCodeProfile {
  readonly name: string;
  /** Absolute; `undefined` when the profile sets no Claude config. */
  readonly claudeConfigDir: string | undefined;
}

export interface ListedCodeProfile {
  readonly name: string;
  readonly root: string;
  /** Absolute; `undefined` when the profile sets no Claude config. */
  readonly claudeConfigDir: string | undefined;
}

export interface CodeProfileClaudeConfigDir {
  readonly profile: string;
  readonly dir: string;
}

export class CodeProfiles extends Context.Service<
  CodeProfiles,
  {
    /**
     * The profile `folder` belongs to. `environment` is the CLI's inherited
     * environment: a CLAUDE_CONFIG_DIR there that is one of the profile's
     * dirs is kept, any other is replaced by the profile's default dir.
     */
    readonly resolve: (
      folder: string,
      environment?: NodeJS.ProcessEnv,
    ) => Effect.Effect<ResolvedCodeProfile | undefined>;
    /** Every profile in settings order, with its default Claude config dir. */
    readonly list: Effect.Effect<ReadonlyArray<ListedCodeProfile>>;
    /** Every Claude config dir the profiles name, defaults first, without duplicates. */
    readonly claudeConfigDirs: Effect.Effect<ReadonlyArray<CodeProfileClaudeConfigDir>>;
  }
>()("t3/provider/CodeProfiles") {}

const MAX_CACHED_CHECKOUTS = 256;

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const physical = (folder: string) => {
    const absolute = path.resolve(expandHomePathWith(folder, path));
    return fileSystem.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
  };

  // Which repository a folder is in does not change, so the git lookup is
  // cached per folder for the life of the server.
  const mainCheckouts = yield* Cache.make({
    capacity: MAX_CACHED_CHECKOUTS,
    timeToLive: Duration.infinity,
    lookup: (folder: string) =>
      resolveMainCheckoutRoot(folder).pipe(
        Effect.flatMap((root) => (root === undefined ? Effect.succeed(undefined) : physical(root))),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Path.Path, path),
      ),
  });

  const profiles = serverSettings.getSettings.pipe(
    Effect.map((settings) => Object.entries(settings.codeProfiles)),
    Effect.orElseSucceed((): ReadonlyArray<readonly [string, CodeProfile]> => []),
  );

  const isWithin = (folder: string, root: string) => {
    const relative = path.relative(root, folder);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const match = Effect.fn("CodeProfiles.match")(function* (
    entries: ReadonlyArray<readonly [string, CodeProfile]>,
    folder: string,
  ) {
    let best:
      | { readonly name: string; readonly profile: CodeProfile; readonly root: string }
      | undefined;
    for (const [name, profile] of entries) {
      const root = yield* physical(profile.root);
      if (isWithin(folder, root) && (best === undefined || root.length > best.root.length)) {
        best = { name, profile, root };
      }
    }
    return best;
  });

  const claudeDirs = (profile: CodeProfile) =>
    profile.claude === undefined
      ? []
      : [profile.claude.configDir, ...profile.claude.extraConfigDirs].map((dir) =>
          path.resolve(expandHomePathWith(dir, path)),
        );

  const resolve = Effect.fn("CodeProfiles.resolve")(function* (
    folder: string,
    environment?: NodeJS.ProcessEnv,
  ) {
    const entries = yield* profiles;
    if (entries.length === 0) return undefined;
    const here = yield* physical(folder);
    let found = yield* match(entries, here);
    if (found === undefined) {
      const mainCheckout = yield* Cache.get(mainCheckouts, here);
      if (mainCheckout !== undefined && mainCheckout !== here) {
        found = yield* match(entries, mainCheckout);
      }
    }
    if (found === undefined) return undefined;
    const [defaultDir, ...extraDirs] = claudeDirs(found.profile);
    const inherited = environment?.CLAUDE_CONFIG_DIR?.trim();
    let claudeConfigDir = defaultDir;
    if (inherited && defaultDir !== undefined) {
      const current = yield* physical(inherited);
      for (const dir of [defaultDir, ...extraDirs]) {
        if ((yield* physical(dir)) === current) claudeConfigDir = dir;
      }
    }
    return { name: found.name, claudeConfigDir } satisfies ResolvedCodeProfile;
  });

  const claudeConfigDirs = profiles.pipe(
    Effect.map((entries) => {
      const seen = new Set<string>();
      const ordered = [
        ...entries.map(([name, profile]) => ({ name, dirs: claudeDirs(profile).slice(0, 1) })),
        ...entries.map(([name, profile]) => ({ name, dirs: claudeDirs(profile).slice(1) })),
      ];
      return ordered.flatMap(({ name, dirs }) =>
        dirs.flatMap((dir) => {
          if (seen.has(dir)) return [];
          seen.add(dir);
          return [{ profile: name, dir }];
        }),
      );
    }),
  );

  const list = profiles.pipe(
    Effect.map((entries) =>
      entries.map(([name, profile]): ListedCodeProfile => ({
        name,
        root: path.resolve(expandHomePathWith(profile.root, path)),
        claudeConfigDir: claudeDirs(profile)[0],
      })),
    ),
  );

  return CodeProfiles.of({ resolve, list, claudeConfigDirs });
});

export const layer = Layer.effect(CodeProfiles, make);
