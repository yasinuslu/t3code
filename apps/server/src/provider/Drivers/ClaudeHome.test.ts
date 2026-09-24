import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  claudeConfigDirFromTranscriptPath,
  claudeSignedOutMessage,
  describeClaudeConfigDir,
  isClaudeConfigDirInherited,
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("treats empty, ~/.claude, and the expanded default as the same Claude home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(path.join(NodeOS.homedir(), ".claude"));

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude" })).toBe(resolved);
        expect(yield* resolveClaudeHomePath({ homePath: resolved })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toBe(process.env);

        const key = `claude:home:${resolved}`;
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(key);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "~/.claude" })).toBe(key);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: resolved })).toBe(key);
      }),
    );

    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("uses inherited CLAUDE_CONFIG_DIR when homePath is empty", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };

        expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" }, environment)).toBe(
          `claude:home:${inherited}`,
        );

        const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
          explicit,
        );
      }),
    );

    it("treats only a blank homePath as leaving the config dir to the CLI", () => {
      expect(isClaudeConfigDirInherited({ homePath: "" })).toBe(true);
      expect(isClaudeConfigDirInherited({ homePath: "   " })).toBe(true);
      // Naming the default dir explicitly still pins it via CLAUDE_CONFIG_DIR.
      expect(isClaudeConfigDirInherited({ homePath: "~/.claude" })).toBe(false);
      expect(isClaudeConfigDirInherited({ homePath: "/synthetic/claude-work" })).toBe(false);
    });

    it("points the signed-out hint at the configured Claude home", () => {
      expect(claudeSignedOutMessage({ configDir: undefined, cwd: "/synthetic" })).toContain(
        "run `claude auth login`",
      );
      const configDir = "/synthetic/Claude work's $literal";
      const message = claudeSignedOutMessage({ configDir, cwd: "/synthetic/project" });
      expect(message).toContain(`CLAUDE_CONFIG_DIR set to "${configDir}"`);
      expect(message).not.toContain("CLAUDE_CONFIG_DIR=");
      expect(message).toContain("then start a new thread");
    });

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );
  });

  describe("effective config dir", () => {
    it("recovers the config dir from a session transcript path", () => {
      expect(
        claudeConfigDirFromTranscriptPath(
          "/home/user/code/work/home/claude/projects/-home-user-code-work-repo/0b6c.jsonl",
        ),
      ).toBe("/home/user/code/work/home/claude");
      expect(
        claudeConfigDirFromTranscriptPath(
          "C:\\Users\\user\\.claude\\projects\\C--repo\\0b6c.jsonl",
        ),
      ).toBe("C:\\Users\\user\\.claude");
    });

    it("keeps the last projects segment when the config dir itself contains one", () => {
      expect(
        claudeConfigDirFromTranscriptPath("/srv/projects/claude/projects/-srv-repo/0b6c.jsonl"),
      ).toBe("/srv/projects/claude");
    });

    it("rejects paths that are not session transcripts", () => {
      expect(claudeConfigDirFromTranscriptPath("")).toBeUndefined();
      expect(claudeConfigDirFromTranscriptPath("/tmp/0b6c.jsonl")).toBeUndefined();
      expect(
        claudeConfigDirFromTranscriptPath("/home/user/.claude/projects/0b6c.jsonl"),
      ).toBeUndefined();
      expect(
        claudeConfigDirFromTranscriptPath("/home/user/.claude/sessions/-repo/0b6c.jsonl"),
      ).toBeUndefined();
      expect(
        claudeConfigDirFromTranscriptPath("/home/user/.claude/projects/-repo/0b6c.json"),
      ).toBeUndefined();
    });

    it.effect("describes a config dir with a home-abbreviated display path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const relative = path.join("code", "personal", "home", "claude");
        const configDir = path.join(NodeOS.homedir(), relative);
        expect(describeClaudeConfigDir(configDir)).toEqual({
          path: configDir,
          displayPath: `~${path.sep}${relative}`,
        });
        expect(describeClaudeConfigDir("/opt/claude")).toEqual({
          path: "/opt/claude",
          displayPath: "/opt/claude",
        });
      }),
    );
  });
});
