import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  projectCodeProfile,
  providerProfileMismatch,
  serverHomeDirectory,
} from "./profileGuard.logic";

const provider = (
  configDir: { path: string; displayPath: string; profile?: string },
  inherited = false,
) => ({ configDir, configDirInherited: inherited }) as unknown as ServerProvider;

describe("profileGuard.logic", () => {
  it("reads the server home off a config dir", () => {
    expect(
      serverHomeDirectory([
        provider({ path: "/Users/a/code/yu/home/claude", displayPath: "~/code/yu/home/claude" }),
      ]),
    ).toBe("/Users/a");
    expect(serverHomeDirectory([])).toBe(null);
  });

  it("prefers the deepest projectProfiles folder over the detected profile", () => {
    const overrides = { "~/code/yu/nepjua": "common", "~/code/yu": "yu" };
    expect(
      projectCodeProfile({
        workspaceRoot: "/Users/a/code/yu/nepjua",
        detectedProfile: "yu",
        overrides,
        homeDirectory: "/Users/a",
      }),
    ).toBe("common");
    expect(
      projectCodeProfile({
        workspaceRoot: "/Users/a/code/sn/app",
        detectedProfile: "sn",
        overrides,
        homeDirectory: "/Users/a",
      }),
    ).toBe("sn");
  });

  it("keeps a pinned instance of another profile out, never a per-workspace one", () => {
    const yu = provider({
      path: "/h/code/yu/home/claude",
      displayPath: "~/code/yu/home/claude",
      profile: "yu",
    });
    expect(providerProfileMismatch(yu, "sn")).toEqual({
      instanceProfile: "yu",
      workspaceProfile: "sn",
    });
    expect(providerProfileMismatch(yu, "yu")).toBe(undefined);
    expect(providerProfileMismatch(yu, "common")).toBe(undefined);
    const router = provider({ path: "/h/.claude", displayPath: "~/.claude", profile: "yu" }, true);
    expect(providerProfileMismatch(router, "sn")).toBe(undefined);
  });
});
