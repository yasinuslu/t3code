// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { CodeProfile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as CodeProfiles from "./CodeProfiles.ts";

const withProfiles = <A, E>(
  codeProfiles: Record<string, CodeProfile>,
  use: (profiles: CodeProfiles.CodeProfiles["Service"]) => Effect.Effect<A, E>,
) =>
  CodeProfiles.CodeProfiles.use(use).pipe(
    Effect.provide(
      CodeProfiles.layer.pipe(
        Layer.provide(ServerSettings.layerTest({ codeProfiles })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.sync(() => NodeChildProcess.execFileSync("git", [...args], { cwd, stdio: "ignore" }));

/** A temp dir with `code/work/app` (a git checkout) and `code/home`. */
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-profiles-" }));
  const work = path.join(root, "code", "work");
  const home = path.join(root, "code", "home");
  const app = path.join(work, "app");
  yield* fs.makeDirectory(app, { recursive: true });
  yield* fs.makeDirectory(home, { recursive: true });
  const claude = (name: string) => path.join(root, "config", name);
  return { root, work, home, app, claude, path, fs };
});

it.layer(NodeServices.layer)("CodeProfiles", (it) => {
  describe("resolve", () => {
    it.effect("leaves every folder alone without profiles", () =>
      Effect.gen(function* () {
        const { app } = yield* fixture;
        expect(yield* withProfiles({}, (profiles) => profiles.resolve(app))).toBe(undefined);
      }).pipe(Effect.scoped),
    );

    it.effect("matches the deepest root by physical path", () =>
      Effect.gen(function* () {
        const { root, work, home, app, claude, path, fs } = yield* fixture;
        const linked = path.join(root, "linked-app");
        yield* fs.symlink(app, linked);
        const profiles = {
          all: {
            root: path.join(root, "code"),
            claude: { configDir: claude("all"), extraConfigDirs: [] },
          },
          work: { root: work, claude: { configDir: claude("work"), extraConfigDirs: [] } },
        } satisfies Record<string, CodeProfile>;
        const [inApp, viaLink, inHome, outside] = yield* withProfiles(profiles, (service) =>
          Effect.all([
            service.resolve(app),
            service.resolve(linked),
            service.resolve(home),
            service.resolve(path.join(root, "config")),
          ]),
        );
        expect(inApp).toEqual({ name: "work", claudeConfigDir: claude("work") });
        expect(viaLink).toEqual({ name: "work", claudeConfigDir: claude("work") });
        expect(inHome).toEqual({ name: "all", claudeConfigDir: claude("all") });
        expect(outside).toBe(undefined);
      }).pipe(Effect.scoped),
    );

    it.effect("gives a worktree outside every root its main checkout's profile", () =>
      Effect.gen(function* () {
        const { root, work, app, claude, path } = yield* fixture;
        yield* git(app, "init", "-q");
        yield* git(
          app,
          "-c",
          "user.email=t@example.com",
          "-c",
          "user.name=T",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "init",
        );
        const worktree = path.join(root, "worktrees", "app-feature");
        yield* git(app, "worktree", "add", "-q", "-b", "feature", worktree);
        const resolved = yield* withProfiles(
          { work: { root: work, claude: { configDir: claude("work"), extraConfigDirs: [] } } },
          (profiles) => profiles.resolve(path.join(worktree)),
        );
        expect(resolved).toEqual({ name: "work", claudeConfigDir: claude("work") });
      }).pipe(Effect.scoped),
    );

    it.effect("keeps an inherited dir of the same profile and replaces any other", () =>
      Effect.gen(function* () {
        const { work, app, claude } = yield* fixture;
        const profiles = {
          work: {
            root: work,
            claude: { configDir: claude("work"), extraConfigDirs: [claude("work-second")] },
          },
        } satisfies Record<string, CodeProfile>;
        const [second, foreign, none] = yield* withProfiles(profiles, (service) =>
          Effect.all([
            service.resolve(app, { CLAUDE_CONFIG_DIR: claude("work-second") }),
            service.resolve(app, { CLAUDE_CONFIG_DIR: claude("other") }),
            service.resolve(app, {}),
          ]),
        );
        expect(second?.claudeConfigDir).toBe(claude("work-second"));
        expect(foreign?.claudeConfigDir).toBe(claude("work"));
        expect(none?.claudeConfigDir).toBe(claude("work"));
      }).pipe(Effect.scoped),
    );

    it.effect("names a profile without Claude config but picks no dir", () =>
      Effect.gen(function* () {
        const { work, app } = yield* fixture;
        expect(
          yield* withProfiles({ work: { root: work } }, (profiles) => profiles.resolve(app)),
        ).toEqual({ name: "work", claudeConfigDir: undefined });
      }).pipe(Effect.scoped),
    );
  });

  it.effect("lists every profile's Claude dirs once, defaults first", () =>
    Effect.gen(function* () {
      const { work, home, claude } = yield* fixture;
      const dirs = yield* withProfiles(
        {
          work: {
            root: work,
            claude: { configDir: claude("work"), extraConfigDirs: [claude("shared")] },
          },
          home: { root: home, claude: { configDir: claude("home"), extraConfigDirs: [] } },
          other: { root: home, claude: { configDir: claude("shared"), extraConfigDirs: [] } },
        },
        (profiles) => profiles.claudeConfigDirs,
      );
      expect(dirs).toEqual([
        { profile: "work", dir: claude("work") },
        { profile: "home", dir: claude("home") },
        { profile: "other", dir: claude("shared") },
      ]);
    }).pipe(Effect.scoped),
  );
});
