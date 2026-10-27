import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveSessionConfigDirObservation,
  normalizeProviderAccentColor,
  providerAccentForegroundColor,
  providerInstanceInitials,
  resolveProviderConfigDirIndicator,
  resolveProviderWorkspaceConfigDir,
  shouldShowInstanceBadge,
} from "./providerInstanceDisplay.ts";

const codex = ProviderDriverKind.make("codex");
const acpRegistry = ProviderDriverKind.make("acpRegistry");

describe("providerInstanceInitials", () => {
  it("treats punctuation as a word break but keeps apostrophes between letters", () => {
    expect(providerInstanceInitials("Codex (hub)")).toBe("CH");
    expect(providerInstanceInitials("work_codex")).toBe("WC");
    expect(providerInstanceInitials("Theo's Codex")).toBe("TC");
    expect(providerInstanceInitials("Codex 'hub'")).toBe("CH");
    expect(providerInstanceInitials("‘hub’")).toBe("HU");
    expect(providerInstanceInitials("(hub)")).toBe("HU");
  });

  it("keeps an emoji whole instead of splitting its surrogate pair", () => {
    expect(providerInstanceInitials("😀 Work")).toBe("😀W");
    expect(providerInstanceInitials("😀")).toBe("😀");
  });
});

describe("normalizeProviderAccentColor", () => {
  // regression: #9899 a non-hex accent must not render as the account badge color
  it("rejects a non-hex value", () => {
    expect(normalizeProviderAccentColor("blue")).toBeUndefined();
  });
});

describe("providerAccentForegroundColor", () => {
  it.each([
    ["#b5f23d", "#000000"],
    ["#2563eb", "#ffffff"],
    ["#777777", "#000000"],
  ])("chooses the higher WCAG contrast foreground for %s", (accent, foreground) => {
    expect(providerAccentForegroundColor(accent)).toBe(foreground);
  });
});

describe("shouldShowInstanceBadge", () => {
  it("hides badges for distinct ACP agents sharing the registry driver", () => {
    const mistral = { driverKind: acpRegistry, acpRegistryAgentId: "mistral-vibe", enabled: true };
    const devin = { driverKind: acpRegistry, acpRegistryAgentId: "devin", enabled: true };
    expect(shouldShowInstanceBadge(mistral, [mistral, devin])).toBe(false);
    expect(shouldShowInstanceBadge(devin, [mistral, devin])).toBe(false);
  });

  it("distinguishes registry instances whose agent identity is unavailable", () => {
    const entry = { driverKind: acpRegistry, enabled: true };
    expect(shouldShowInstanceBadge(entry, [entry, { ...entry }])).toBe(true);
  });

  it("shows the badge when the entry has an accent color", () => {
    const entry = { driverKind: codex, accentColor: "#ff8800", enabled: true };
    expect(shouldShowInstanceBadge(entry, [entry])).toBe(true);
  });

  it("shows the badge when two entries share a driver, even without an accent", () => {
    const first = { driverKind: codex, accentColor: undefined, enabled: true };
    const second = { driverKind: codex, accentColor: undefined, enabled: true };
    expect(shouldShowInstanceBadge(first, [first, second])).toBe(true);
  });

  it("ignores disabled siblings for enabled instances while distinguishing historical owners", () => {
    const enabled = { driverKind: codex, enabled: true };
    const disabled = { driverKind: codex, enabled: false };

    expect(shouldShowInstanceBadge(enabled, [enabled, disabled])).toBe(false);
    expect(shouldShowInstanceBadge(disabled, [enabled, disabled])).toBe(true);
    expect(shouldShowInstanceBadge(disabled, [disabled, { ...disabled }])).toBe(true);
    expect(shouldShowInstanceBadge(disabled, [disabled])).toBe(false);
  });
});

const workDir = {
  path: "/home/user/code/work/home/claude",
  displayPath: "~/code/work/home/claude",
};
const personalDir = {
  path: "/home/user/code/personal/home/claude",
  displayPath: "~/code/personal/home/claude",
};

describe("deriveSessionConfigDirObservation", () => {
  it("returns the dir the session's CLI reported next to the launch dir", () => {
    expect(
      deriveSessionConfigDirObservation({
        configDir: { configured: workDir, effective: personalDir },
      }),
    ).toEqual({ configured: workDir, effective: personalDir });
  });

  it("returns null until the session's CLI reported a dir", () => {
    expect(deriveSessionConfigDirObservation(undefined)).toBeNull();
    expect(deriveSessionConfigDirObservation(null)).toBeNull();
    expect(deriveSessionConfigDirObservation({})).toBeNull();
    expect(deriveSessionConfigDirObservation({ configDir: { configured: workDir } })).toBeNull();
  });
});

describe("resolveProviderConfigDirIndicator", () => {
  it("shows the configured dir until a session reports one", () => {
    expect(resolveProviderConfigDirIndicator({ configured: workDir, observation: null })).toEqual({
      current: workDir,
      configured: workDir,
      redirected: false,
    });
    expect(
      resolveProviderConfigDirIndicator({ configured: undefined, observation: null }),
    ).toBeNull();
  });

  it("flags a session the CLI ran under a different dir", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: workDir,
        observation: { configured: workDir, effective: personalDir },
      }),
    ).toEqual({ current: personalDir, configured: workDir, redirected: true });
  });

  it("ignores trailing separators when comparing dirs", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: workDir,
        observation: {
          configured: workDir,
          effective: { path: `${workDir.path}/`, displayPath: `${workDir.displayPath}/` },
        },
      })?.redirected,
    ).toBe(false);
  });

  it("keeps the workspace's code profile for a session that recorded none", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: { ...workDir, profile: "work" },
        observation: { configured: workDir, effective: workDir },
      }),
    ).toEqual({ current: workDir, configured: { ...workDir, profile: "work" }, redirected: false });
  });

  it("drops an observation made under a previous configured dir", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: personalDir,
        observation: { configured: workDir, effective: workDir },
      }),
    ).toEqual({ current: personalDir, configured: personalDir, redirected: false });
  });

  it("leaves an inherited dir unknown until a session reports one", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: workDir,
        inherited: true,
        observation: null,
      }),
    ).toEqual({ current: null, configured: workDir, redirected: false });
  });

  it("shows the observed dir without a redirect when nothing was configured", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: workDir,
        inherited: true,
        observation: { configured: workDir, effective: personalDir },
      }),
    ).toEqual({ current: personalDir, configured: workDir, redirected: false });
  });

  it("treats an observation from before the dir became inherited as stale", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: workDir,
        inherited: true,
        observation: { configured: personalDir, effective: personalDir },
      }),
    ).toEqual({ current: null, configured: workDir, redirected: false });
  });

  it("shows nothing for instances that do not report a config dir", () => {
    expect(
      resolveProviderConfigDirIndicator({
        configured: undefined,
        observation: { configured: workDir, effective: personalDir },
      }),
    ).toBeNull();
  });
});

describe("resolveProviderWorkspaceConfigDir", () => {
  const workspace = (cwd: string, configDir?: typeof workDir) => ({
    cwd,
    checkedAt: "2026-01-01T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    ...(configDir ? { configDir } : {}),
  });

  it("prefers the dir resolved for the workspace over the instance guess", () => {
    expect(
      resolveProviderWorkspaceConfigDir(
        {
          configDir: personalDir,
          configDirInherited: true,
          workspaceSnapshots: [workspace("/repo/other"), workspace("/repo/work", workDir)],
        },
        "/repo/work",
      ),
    ).toEqual({ configured: workDir, inherited: false });
  });

  it("falls back to the instance dir when the workspace has none", () => {
    const provider = {
      configDir: personalDir,
      configDirInherited: true,
      workspaceSnapshots: [workspace("/repo/work")],
    };
    expect(resolveProviderWorkspaceConfigDir(provider, "/repo/work")).toEqual({
      configured: personalDir,
      inherited: true,
    });
    expect(resolveProviderWorkspaceConfigDir(provider, null)).toEqual({
      configured: personalDir,
      inherited: true,
    });
    expect(resolveProviderWorkspaceConfigDir({ configDir: workDir }, "/repo/work")).toEqual({
      configured: workDir,
      inherited: false,
    });
  });
});
