// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { abbreviateHomePath, expandHomePath } from "./pathExpansion.ts";

describe("expandHomePath", () => {
  it("returns an empty string unchanged", () => {
    expect(expandHomePath("")).toBe("");
  });

  it("returns paths without a leading tilde unchanged", () => {
    expect(expandHomePath("/absolute/path")).toBe("/absolute/path");
    expect(expandHomePath("relative/path")).toBe("relative/path");
    expect(expandHomePath("some~weird~path")).toBe("some~weird~path");
  });

  it("expands a lone tilde to the home directory", () => {
    expect(expandHomePath("~")).toBe(NodeOS.homedir());
  });

  it("expands ~/ to a subpath of the home directory", () => {
    expect(expandHomePath("~/.codex-work")).toBe(NodePath.join(NodeOS.homedir(), ".codex-work"));
  });

  it("expands a Windows-style ~\\ prefix", () => {
    expect(expandHomePath("~\\.codex")).toBe(NodePath.join(NodeOS.homedir(), ".codex"));
  });

  it("does not expand ~user paths", () => {
    expect(expandHomePath("~alice/foo")).toBe("~alice/foo");
  });
});

describe("abbreviateHomePath", () => {
  it("abbreviates the home directory itself and paths below it", () => {
    expect(abbreviateHomePath("/home/user", "/home/user")).toBe("~");
    expect(abbreviateHomePath("/home/user/code/work/home/claude", "/home/user")).toBe(
      "~/code/work/home/claude",
    );
    expect(abbreviateHomePath("/home/user/.claude", "/home/user/")).toBe("~/.claude");
  });

  it("abbreviates Windows-style paths", () => {
    expect(abbreviateHomePath("C:\\Users\\user\\.claude", "C:\\Users\\user")).toBe("~\\.claude");
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(abbreviateHomePath("/home/username/.claude", "/home/user")).toBe(
      "/home/username/.claude",
    );
    expect(abbreviateHomePath("/opt/claude", "/home/user")).toBe("/opt/claude");
    expect(abbreviateHomePath("/opt/claude", "")).toBe("/opt/claude");
  });

  it("round-trips with expandHomePath for the current user", () => {
    const expanded = expandHomePath("~/code/personal/home/claude");
    expect(abbreviateHomePath(expanded)).toBe(
      `~${NodePath.sep}${NodePath.join("code", "personal", "home", "claude")}`,
    );
  });
});
