import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import {
  makeClaudeConfigDirResolver,
  runClaudeConfigDirCommand,
} from "./ClaudeConfigDirCommand.ts";

// Commands run through the POSIX shell; Windows runs them through cmd.exe,
// where these fixtures do not apply.
const isWindows = HostProcessPlatform.defaultValue() === "win32";

it.layer(NodeServices.layer)("ClaudeConfigDirCommand", (it) => {
  describe("runClaudeConfigDirCommand", () => {
    it.effect.skipIf(isWindows)(
      "runs in the given directory and returns the printed absolute dir",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const project = yield* fs.realPath(
            yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-config-dir-" }),
          );
          expect(
            yield* runClaudeConfigDirCommand({
              command: `printf '%s/home\\n' "$PWD"`,
              cwd: project,
            }),
          ).toBe(`${project}/home`);
        }).pipe(Effect.scoped),
    );

    it.effect.skipIf(isWindows)("expands a leading ~ to the server user's home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        expect(
          yield* runClaudeConfigDirCommand({ command: "echo '~/.claude-work'", cwd: "/" }),
        ).toBe(path.join(NodeOS.homedir(), ".claude-work"));
      }),
    );

    it.effect.skipIf(isWindows)("rejects relative, empty, and multi-line output", () =>
      Effect.gen(function* () {
        for (const command of ["echo relative/dir", "true", "printf '/a\\n/b\\n'"]) {
          const error = yield* Effect.flip(runClaudeConfigDirCommand({ command, cwd: "/" }));
          expect(error._tag).toBe("ClaudeConfigDirCommandError");
          expect(error.detail).toContain("expected one absolute path");
        }
      }),
    );

    it.effect.skipIf(isWindows)("fails on a non-zero exit and reports stderr", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          runClaudeConfigDirCommand({ command: "echo nope >&2; exit 3", cwd: "/" }),
        );
        expect(error.detail).toContain("exited with 3");
        expect(error.detail).toContain("nope");
      }),
    );

    it.effect.skipIf(isWindows)("gives up on a command that outlives its timeout", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          runClaudeConfigDirCommand({ command: "sleep 5", cwd: "/", timeout: "100 millis" }),
        );
        expect(error.detail).toBe("timed out");
        // Live clock: the test clock would never let the timeout fire.
      }).pipe(TestClock.withLive),
    );
  });

  describe("makeClaudeConfigDirResolver", () => {
    it.effect("is absent without a command or when homePath is set", () =>
      Effect.gen(function* () {
        expect(yield* makeClaudeConfigDirResolver({ homePath: "", homePathCommand: "" })).toBe(
          undefined,
        );
        expect(
          yield* makeClaudeConfigDirResolver({
            homePath: "~/.claude-work",
            homePathCommand: "echo /synthetic",
          }),
        ).toBe(undefined);
      }),
    );

    it.effect.skipIf(isWindows)("caches successes per project root and retries failures", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-config-dir-" }),
        );
        const first = path.join(root, "first");
        const second = path.join(root, "second");
        yield* fs.makeDirectory(first);
        yield* fs.makeDirectory(second);
        const counter = path.join(root, "runs");
        // Counts runs, fails in any directory holding a `fail` marker, and
        // otherwise prints a dir derived from the working directory.
        const command = `echo x >> '${counter}'; [ -e fail ] && exit 1; printf '%s/claude\\n' "$PWD"`;
        const resolver = yield* makeClaudeConfigDirResolver({
          homePath: "",
          homePathCommand: command,
        });
        if (!resolver) return expect.unreachable("resolver expected");
        const runs = () =>
          fs.readFileString(counter).pipe(Effect.map((text) => text.trim().split("\n").length));

        expect(yield* resolver.resolve(first)).toBe(path.join(first, "claude"));
        expect(yield* resolver.resolve(first)).toBe(path.join(first, "claude"));
        expect(yield* resolver.resolve(second)).toBe(path.join(second, "claude"));
        expect(yield* runs()).toBe(2);

        yield* fs.writeFileString(path.join(second, "fail"), "");
        yield* resolver.invalidate;
        expect(yield* resolver.resolve(second)).toBe(undefined);
        expect(yield* resolver.resolve(second)).toBe(undefined);
        expect(yield* runs()).toBe(4);

        yield* fs.remove(path.join(second, "fail"));
        expect(yield* resolver.resolve(second)).toBe(path.join(second, "claude"));
        expect(yield* runs()).toBe(5);
      }).pipe(Effect.scoped),
    );
  });
});
