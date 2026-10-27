import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsSheet.logic";

const options = { keybindings: DEFAULT_RESOLVED_KEYBINDINGS, platform: "Linux" };

const rowKeys = (sections: ReturnType<typeof buildShortcutSections>, label: string) =>
  sections.flatMap((section) => section.rows).find((row) => row.label === label)?.keys;

describe("buildShortcutSections", () => {
  it("writes the profile keys for the platform", () => {
    expect(rowKeys(buildShortcutSections(options), "Next / previous profile")).toEqual([
      "Alt+V",
      "Alt+Shift+V",
    ]);
    expect(
      rowKeys(
        buildShortcutSections({ ...options, platform: "MacIntel" }),
        "Next / previous profile",
      ),
    ).toEqual(["⌃V", "⌃⇧V"]);
  });

  it("shows the sidebar chord: Ctrl+S, or Ctrl+B on a Mac", () => {
    expect(rowKeys(buildShortcutSections(options), "Focus the sidebar")).toEqual(["Ctrl+S"]);
    expect(
      rowKeys(buildShortcutSections({ ...options, platform: "MacIntel" }), "Focus the sidebar"),
    ).toEqual(["⌃B"]);
  });

  it("follows the live keybindings: a remapped command shows its new key, a removed one is dropped", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "mod+shift+y", command: "manager.toggle" },
    ]);
    const sections = buildShortcutSections({ ...options, keybindings });
    expect(rowKeys(sections, "Manager")).toEqual(["Ctrl+Shift+Y"]);
    expect(rowKeys(sections, "Command palette")).toBeUndefined();
  });
});
