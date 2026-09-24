import {
  EventId,
  type OrchestrationThreadActivity,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveLatestConfigDirObservation,
  normalizeProviderAccentColor,
  providerInstanceInitials,
  resolveProviderConfigDirIndicator,
  resolveProviderWorkspaceConfigDir,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "./providerInstanceDisplay.ts";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");

describe("resolveProviderInstanceDisplayName", () => {
  it("keeps a snapshot name that differs from the brand label", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex"),
        driver: codex,
        displayName: "Work",
      }),
    ).toBe("Work");
  });

  it("humanizes a custom instance id when the snapshot only carries the brand label", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex_personal"),
        driver: codex,
        displayName: "Codex",
      }),
    ).toBe("Codex Personal");
  });

  it("uses the brand label for the default instance", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex"),
        driver: codex,
      }),
    ).toBe("Codex");
  });
});

describe("providerInstanceInitials", () => {
  it("takes the first two characters of a single word", () => {
    expect(providerInstanceInitials("Codex")).toBe("CO");
  });

  it("takes the first character of each of the first two words", () => {
    expect(providerInstanceInitials("Codex Personal")).toBe("CP");
  });

  it("ignores words past the first two", () => {
    expect(providerInstanceInitials("Codex Personal Backup Account")).toBe("CP");
  });

  it("returns an empty string for an empty label", () => {
    expect(providerInstanceInitials("")).toBe("");
  });

  it("keeps an emoji whole instead of splitting its surrogate pair", () => {
    expect(providerInstanceInitials("😀 Work")).toBe("😀W");
    expect(providerInstanceInitials("😀")).toBe("😀");
  });
});

describe("normalizeProviderAccentColor", () => {
  it("accepts a lowercase hex color", () => {
    expect(normalizeProviderAccentColor("#ff8800")).toBe("#ff8800");
  });

  it("accepts an uppercase hex color", () => {
    expect(normalizeProviderAccentColor("#FF8800")).toBe("#FF8800");
  });

  it("rejects a non-hex value", () => {
    expect(normalizeProviderAccentColor("blue")).toBeUndefined();
  });

  it("rejects a short hex value", () => {
    expect(normalizeProviderAccentColor("#fff")).toBeUndefined();
  });

  it("treats undefined and blank as unset", () => {
    expect(normalizeProviderAccentColor(undefined)).toBeUndefined();
    expect(normalizeProviderAccentColor("   ")).toBeUndefined();
  });
});

describe("shouldShowInstanceBadge", () => {
  it("shows the badge when the entry has an accent color", () => {
    const entry = { driverKind: codex, accentColor: "#ff8800" };
    expect(shouldShowInstanceBadge(entry, [entry])).toBe(true);
  });

  it("shows the badge when two entries share a driver, even without an accent", () => {
    const first = { driverKind: codex, accentColor: undefined };
    const second = { driverKind: codex, accentColor: undefined };
    expect(shouldShowInstanceBadge(first, [first, second])).toBe(true);
  });

  it("hides the badge for a single instance of a driver with no accent", () => {
    const entry = { driverKind: codex, accentColor: undefined };
    const other = { driverKind: claude, accentColor: undefined };
    expect(shouldShowInstanceBadge(entry, [entry, other])).toBe(false);
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

function activity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("deriveLatestConfigDirObservation", () => {
  it("returns the newest well-formed observation", () => {
    const older = { configured: workDir, effective: workDir };
    const newer = { configured: workDir, effective: personalDir };
    expect(
      deriveLatestConfigDirObservation([
        activity("a", "provider.config-dir", older),
        activity("b", "provider.config-dir", newer),
        activity("c", "context-window.updated", { usedTokens: 1 }),
        activity("d", "provider.config-dir", { configured: workDir }),
      ]),
    ).toEqual(newer);
  });

  it("returns null when no session reported a config dir", () => {
    expect(deriveLatestConfigDirObservation([])).toBeNull();
    expect(deriveLatestConfigDirObservation([activity("a", "tool.completed", workDir)])).toBeNull();
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
