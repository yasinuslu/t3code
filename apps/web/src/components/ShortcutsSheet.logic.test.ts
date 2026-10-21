import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsSheet.logic";

const options = {
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
  platform: "Linux",
  mac: false,
  inGrow: true,
  growAvailable: true,
};

const rowKeys = (sections: ReturnType<typeof buildShortcutSections>, label: string) =>
  sections.flatMap((section) => section.rows).find((row) => row.label === label)?.keys;

describe("buildShortcutSections", () => {
  it("puts Grow's keys first in Grow, and the app-wide ones first elsewhere", () => {
    const scopes = (inGrow: boolean) => [
      ...new Set(buildShortcutSections({ ...options, inGrow }).map((section) => section.scope)),
    ];
    expect(scopes(true)).toEqual(["grow", "app"]);
    expect(scopes(false)).toEqual(["app", "grow"]);
  });

  it("leaves Grow out when the fork features are off", () => {
    const sections = buildShortcutSections({ ...options, growAvailable: false });
    expect(sections.every((section) => section.scope === "app")).toBe(true);
  });

  it("writes the shifted profile key and the Alt chord for the platform", () => {
    const linux = buildShortcutSections(options);
    expect(rowKeys(linux, "Next / previous profile")).toEqual(["V", "Shift+V"]);
    const global = (sections: typeof linux) =>
      sections.filter((section) => section.scope === "app");
    expect(rowKeys(global(linux), "Next / previous profile")).toEqual(["Alt+V", "Alt+Shift+V"]);

    const mac = buildShortcutSections({ ...options, platform: "MacIntel", mac: true });
    expect(
      mac.filter((section) => section.scope === "grow").flatMap((section) => section.rows),
    ).toContainEqual({ label: "Next / previous profile", keys: ["V", "⇧V"] });
    expect(rowKeys(global(mac), "Next / previous profile")).toEqual(["⌥V", "⌥⇧V"]);
  });

  it("follows the live keybindings: a remapped command shows its new key, a removed one is dropped", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "mod+shift+y", command: "manager.toggle" },
    ]);
    const sections = buildShortcutSections({ ...options, inGrow: false, keybindings });
    expect(rowKeys(sections, "Manager")).toEqual(["Ctrl+Shift+Y"]);
    expect(rowKeys(sections, "Command palette")).toBeUndefined();
  });
});
