import { describe, expect, it } from "vite-plus/test";

import {
  preferredSandboxHostPort,
  renderSandboxEnvFile,
  sandboxContainerName,
  sandboxEnvNames,
  sandboxExecLauncherArgs,
} from "./sandboxCommon.ts";
import { makeDockerBackend } from "./sandboxDocker.ts";
import { makeMicrosandboxBackend, microsandboxRunArgs } from "./sandboxMicrosandbox.ts";
import * as Effect from "effect/Effect";

describe("sandboxEnvNames", () => {
  const hostEnv = {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/Users/theo",
    XDG_RUNTIME_DIR: "/run/user/501",
    EDITOR: "vim",
    ANTHROPIC_API_KEY: "sk-host",
    LANG: "en_US.UTF-8",
  };

  it("passes overrides and inherited credentials but not host plumbing", () => {
    const names = sandboxEnvNames(
      {
        ...hostEnv,
        PATH: "/managed/bin:/usr/local/bin:/usr/bin",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        T3_THREAD: "thread-1",
      },
      hostEnv,
    );
    expect(names).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_ENTRYPOINT", "LANG", "T3_THREAD"]);
  });

  it("skips unset values", () => {
    expect(sandboxEnvNames({ OPENAI_API_KEY: undefined }, {})).toEqual([]);
  });
});

describe("sandbox exec", () => {
  it("keeps env values out of argv and loads them from the env file", () => {
    const argv = sandboxExecLauncherArgs("exec-1", "/state/sandboxes/x/exec-1.env", "claude", [
      "--output-format",
      "stream-json",
    ]);
    expect(argv.slice(3)).toEqual([
      "exec-1",
      "/state/sandboxes/x/exec-1.env",
      "claude",
      "--output-format",
      "stream-json",
    ]);
    expect(argv.join(" ")).not.toContain("sk-");
  });

  it("renders env files that survive shell metacharacters", () => {
    expect(renderSandboxEnvFile({ ANTHROPIC_API_KEY: "sk-'x' $HOME", "BAD-NAME": "x" })).toBe(
      "export ANTHROPIC_API_KEY='sk-'\\''x'\\'' $HOME'\n",
    );
  });

  it("runs commands through each backend's exec", () => {
    const cli = () => Effect.succeed("");
    const input = { name: "sbx", cwd: "/work/tree", tty: false, argv: ["node", "-v"] };
    expect(makeDockerBackend({ cli, owner: "o", registryPath: "/r" }).execArgs(input)).toEqual([
      "exec",
      "-i",
      "-w",
      "/work/tree",
      "sbx",
      "node",
      "-v",
    ]);
    const msb = makeMicrosandboxBackend({
      cli,
      owner: "o",
      registryPath: "/r",
      resources: { cpus: 2, memory: "4G" },
      kvmAvailable: () => Effect.succeed(true),
    });
    expect(msb.execArgs({ ...input, root: true })).toEqual([
      "exec",
      "--quiet",
      "--workdir",
      "/work/tree",
      "--user",
      "root",
      "sbx",
      "--",
      "node",
      "-v",
    ]);
  });
});

describe("microsandbox run args", () => {
  it("boots from the base snapshot with mounts at their host paths", () => {
    const args = microsandboxRunArgs({
      name: "sbx",
      worktreePath: "/work/tree",
      image: "t3code-sandbox-base-abc",
      versions: { claude: "2.1.300", codex: "0.162.1" },
      mounts: [
        { path: "/work/tree", readOnly: false },
        { path: "/home/u/.gitconfig", readOnly: true, file: true },
      ],
      uid: 1000,
      gid: 100,
      home: "/home/u",
      ipv6Loopback: false,
      owner: "o",
      resources: { cpus: 2, memory: "4G" },
    });
    expect(args.slice(0, 6)).toEqual([
      "run",
      "--quiet",
      "--detach",
      "--replace",
      "--snapshot",
      "t3code-sandbox-base-abc",
    ]);
    expect(args).toContain("t3code.sandbox.worktree=/work/tree");
    expect(args.slice(-4)).toEqual([
      "-v",
      "/work/tree:/work/tree",
      "--mount-file",
      "/home/u/.gitconfig:/home/u/.gitconfig:ro",
    ]);
  });

  it("mounts a read-only project before its writable git dir", () => {
    const args = microsandboxRunArgs({
      name: "sbx",
      worktreePath: "/work/tree",
      image: "base",
      versions: { claude: "latest", codex: "latest" },
      mounts: [
        { path: "/repo/.git", readOnly: false },
        { path: "/repo", readOnly: true },
      ],
      uid: 1000,
      gid: 100,
      home: "/home/u",
      ipv6Loopback: false,
      owner: "o",
      resources: { cpus: 2, memory: "4G" },
    });
    expect(args.slice(-4)).toEqual(["-v", "/repo:/repo:ro", "-v", "/repo/.git:/repo/.git"]);
  });
});

describe("sandbox names", () => {
  it("derives a stable, Docker-safe container name per worktree", () => {
    const name = sandboxContainerName("/Users/theo/.t3/worktrees/t3code/Feature Branch!");
    expect(name).toMatch(/^t3code-sandbox-feature-branch-[0-9a-f]{8}$/);
    expect(sandboxContainerName("/Users/theo/.t3/worktrees/t3code/Feature Branch!")).toBe(name);
    expect(sandboxContainerName("/other/Feature Branch!")).not.toBe(name);
  });

  it("keeps preferred host ports in a fixed range", () => {
    const port = preferredSandboxHostPort("t3code-sandbox-x", 3000);
    expect(port).toBeGreaterThanOrEqual(42000);
    expect(port).toBeLessThan(50000);
    expect(preferredSandboxHostPort("t3code-sandbox-x", 3000)).toBe(port);
  });
});
