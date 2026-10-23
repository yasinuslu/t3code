import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsSheet.logic";

const options = {
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
  platform: "Linux",
  inGrow: true,
  growAvailable: true,
};

const rowKeys = (sections: ReturnType<typeof buildShortcutSections>, label: string) =>
  sections.flatMap((section) => section.rows).find((row) => row.label === label)?.keys;

const grow = (sections: ReturnType<typeof buildShortcutSections>) =>
  sections.filter((section) => section.scope === "grow");

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

  it("writes Grow's keys with Alt on a PC and with Control on a Mac", () => {
    const linux = grow(buildShortcutSections(options));
    expect(rowKeys(linux, "Previous / next thread")).toEqual(["Alt+W", "Alt+S"]);
    expect(rowKeys(linux, "Settle, superseded by...")).toEqual(["Alt+Shift+X"]);

    const mac = grow(buildShortcutSections({ ...options, platform: "MacIntel" }));
    expect(rowKeys(mac, "Previous / next thread")).toEqual(["⌃W", "⌃S"]);
    expect(rowKeys(mac, "Settle, superseded by...")).toEqual(["⌃⇧X"]);
    // Ctrl+E is the manager on a Mac, so the card's main move sits on Ctrl+Shift+E.
    expect(rowKeys(mac, "Ship, or done")).toEqual(["⌃⇧E"]);
  });

  it("writes the profile keys for the platform", () => {
    const linux = buildShortcutSections(options);
    expect(rowKeys(grow(linux), "Next / previous profile")).toEqual(["Alt+V", "Alt+Shift+V"]);
    const mac = buildShortcutSections({ ...options, platform: "MacIntel" });
    expect(rowKeys(grow(mac), "Next / previous profile")).toEqual(["⌃V", "⌃⇧V"]);
    expect(
      rowKeys(
        mac.filter((section) => section.scope === "app"),
        "Next / previous profile",
      ),
    ).toEqual(["⌃V", "⌃⇧V"]);
  });

  it("shows the sidebar chord in Grow too: Ctrl+B on a Mac, free of Grow's Ctrl+S", () => {
    const mac = { ...options, platform: "MacIntel" };
    for (const inGrow of [false, true]) {
      expect(rowKeys(buildShortcutSections({ ...mac, inGrow }), "Focus the sidebar")).toEqual([
        "⌃B",
      ]);
    }
    expect(
      rowKeys(buildShortcutSections({ ...options, inGrow: true }), "Focus the sidebar"),
    ).toEqual(["Ctrl+S"]);
  });

  it("follows the live keybindings: a remapped command shows its new key, a removed one is dropped", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "mod+shift+y", command: "manager.toggle" },
      { key: "alt+i", command: "grow.step.previous" },
    ]);
    const sections = buildShortcutSections({ ...options, inGrow: false, keybindings });
    expect(rowKeys(sections, "Manager")).toEqual(["Ctrl+Shift+Y"]);
    expect(rowKeys(sections, "Command palette")).toBeUndefined();
    expect(rowKeys(grow(sections), "Previous / next thread")).toEqual(["Alt+I"]);
  });
});
