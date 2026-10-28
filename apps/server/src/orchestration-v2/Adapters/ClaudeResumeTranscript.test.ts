import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { claudeProjectDirName, ensureClaudeResumeTranscript } from "./ClaudeResumeTranscript.ts";

const SESSION = "0c907d22-4291-42fa-8316-2d2a1ccdf5be";

const writeTranscript = Effect.fn(function* (configDir: string, cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(configDir, "projects", claudeProjectDirName(cwd));
  yield* fs.makeDirectory(path.join(dir, SESSION, "tool-results"), { recursive: true });
  yield* fs.writeFileString(path.join(dir, `${SESSION}.jsonl`), '{"type":"user"}\n');
  yield* fs.writeFileString(path.join(dir, SESSION, "tool-results", "a.txt"), "out");
});

describe("ensureClaudeResumeTranscript", () => {
  it("maps a cwd to Claude's project dir name", () => {
    expect(claudeProjectDirName("/home/u/.t3/worktrees/t3code/feat-x")).toBe(
      "-home-u--t3-worktrees-t3code-feat-x",
    );
  });

  it.effect("finds the transcript where the CLI looks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      yield* writeTranscript(home, "/work/repo");
      const status = yield* ensureClaudeResumeTranscript({
        configDir: home,
        cwd: "/work/repo",
        sessionId: SESSION,
      });
      expect(status._tag).toBe("present");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("copies the transcript after the thread moved to another cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      yield* writeTranscript(home, "/work/worktrees/feat-x");
      const status = yield* ensureClaudeResumeTranscript({
        configDir: home,
        cwd: "/work/repo",
        sessionId: SESSION,
      });
      expect(status._tag).toBe("copied");
      const target = path.join(home, "projects", claudeProjectDirName("/work/repo"));
      expect(yield* fs.readFileString(path.join(target, `${SESSION}.jsonl`))).toBe(
        '{"type":"user"}\n',
      );
      expect(yield* fs.exists(path.join(target, SESSION, "tool-results", "a.txt"))).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("copies the transcript from the config dir that wrote it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writer = yield* fs.makeTempDirectoryScoped();
      const other = yield* fs.makeTempDirectoryScoped();
      yield* writeTranscript(writer, "/work/repo");
      const status = yield* ensureClaudeResumeTranscript({
        configDir: other,
        cwd: "/work/repo",
        sessionId: SESSION,
        searchConfigDirs: [writer],
      });
      expect(status).toEqual({
        _tag: "copied",
        from: path.join(writer, "projects", claudeProjectDirName("/work/repo"), `${SESSION}.jsonl`),
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a transcript that is gone everywhere", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const status = yield* ensureClaudeResumeTranscript({
        configDir: home,
        cwd: "/work/repo",
        sessionId: SESSION,
        searchConfigDirs: ["/nonexistent/claude"],
      });
      expect(status._tag).toBe("missing");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
