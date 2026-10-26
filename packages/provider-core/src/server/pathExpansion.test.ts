import { describe, expect, it } from "vite-plus/test";

import { abbreviateHomePath, expandHomePath } from "./pathExpansion.ts";

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

  it("round-trips with expandHomePath", () => {
    const expanded = expandHomePath("~/code/personal", "/home/user");
    expect(abbreviateHomePath(expanded, "/home/user")).toBe("~/code/personal");
  });
});
