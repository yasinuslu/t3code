import type { KeybindingShortcut, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { initialSpaceState, type Space } from "../../spaceStore";
import {
  brainstormAccelerator,
  brainstormSpacesInput,
  membershipChangesToAdopt,
  shortcutToAccelerator,
} from "./brainstorm.logic";

const shortcut = (
  key: string,
  modifiers: Partial<KeybindingShortcut> = {},
): KeybindingShortcut => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
  ...modifiers,
});

describe("brainstormSpacesInput", () => {
  it("classifies spaces and keeps only this environment's memberships", () => {
    const profile: Space = {
      id: "space-yu",
      name: "yu",
      color: "blue",
      icon: { kind: "monogram", text: "YU", color: "blue" },
      profile: "yu",
    };
    const custom: Space = { ...profile, id: "space-x", name: "Side", profile: null };
    const input = brainstormSpacesInput(
      {
        spaces: [initialSpaceState.spaces[0]!, profile, custom, initialSpaceState.spaces[1]!],
        customSpaceIdsByProjectKey: {
          "env-1:project-a": ["space-x"],
          "env-2:project-b": ["space-x"],
        },
      },
      "env-1",
    );
    expect(input.spaces.map((space) => [space.id, space.kind])).toEqual([
      ["all", "all"],
      ["space-yu", "profile"],
      ["space-x", "custom"],
      ["other", "other"],
    ]);
    expect(input.customSpaceIdsByProjectId).toEqual({ "project-a": ["space-x"] });
  });
});

describe("membershipChangesToAdopt", () => {
  it("adds and removes memberships to match the server for one environment", () => {
    expect(
      membershipChangesToAdopt(
        { "env-1:a": ["s1"], "env-1:b": ["s2"], "env-2:c": ["s1"] },
        { a: ["s1", "s3"], d: ["s2"] },
        "env-1",
      ),
    ).toEqual([
      ["env-1:a", "s3", true],
      ["env-1:d", "s2", true],
      ["env-1:b", "s2", false],
    ]);
  });
});

describe("shortcutToAccelerator", () => {
  it("maps keybinding shortcuts to Electron accelerators", () => {
    expect(shortcutToAccelerator(shortcut(" ", { modKey: true, shiftKey: true }))).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(shortcutToAccelerator(shortcut("b", { ctrlKey: true, altKey: true }))).toBe(
      "Control+Alt+B",
    );
    expect(shortcutToAccelerator(shortcut("f5", { metaKey: true }))).toBe("Super+F5");
    expect(shortcutToAccelerator(shortcut("arrowup", { modKey: true }))).toBe(
      "CommandOrControl+Up",
    );
  });

  it("never registers a bare key system-wide", () => {
    expect(shortcutToAccelerator(shortcut("b"))).toBeNull();
  });

  it("uses the last unconditional binding of the command", () => {
    const keybindings = [
      { command: "brainstorm.toggle", shortcut: shortcut(" ", { modKey: true, shiftKey: true }) },
      {
        command: "brainstorm.toggle",
        shortcut: shortcut("b", { modKey: true }),
        whenAst: { type: "identifier", name: "terminalFocus" },
      },
      { command: "chat.new", shortcut: shortcut("n", { modKey: true }) },
    ] as ResolvedKeybindingsConfig;
    expect(brainstormAccelerator(keybindings)).toBe("CommandOrControl+Shift+Space");
    expect(brainstormAccelerator([])).toBeNull();
  });
});
