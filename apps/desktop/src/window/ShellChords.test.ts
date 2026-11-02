import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  defaultShellChords,
  menuAccelerator,
  profileWindowShortcutIndex,
  setShellChords,
} from "./ShellChords.ts";

const press = (
  code: string,
  modifiers: Partial<Record<"alt" | "control" | "meta" | "shift" | "isAutoRepeat", boolean>> = {},
  type: "keyDown" | "keyUp" = "keyDown",
) => ({
  type,
  code,
  key: "x",
  alt: false,
  control: false,
  meta: false,
  shift: false,
  isAutoRepeat: false,
  ...modifiers,
});

// A list nothing has reported yet falls back to the defaults, so reset it between tests.
afterEach(() => {
  setShellChords(defaultShellChords("linux"));
});

describe("profile window keys", () => {
  it("open window N with Alt+Shift+N on Linux and Windows, by physical key", () => {
    expect(profileWindowShortcutIndex(press("Digit1", { alt: true, shift: true }), "linux")).toBe(
      0,
    );
    expect(profileWindowShortcutIndex(press("Digit9", { alt: true, shift: true }), "win32")).toBe(
      8,
    );
    expect(profileWindowShortcutIndex(press("Digit0", { alt: true, shift: true }), "linux")).toBe(
      null,
    );
  });

  it("leave plain Alt+digit to the page", () => {
    expect(profileWindowShortcutIndex(press("Digit1", { alt: true }), "linux")).toBeNull();
  });

  it("use Control+Shift on a Mac", () => {
    const platform = "darwin";
    setShellChords(defaultShellChords(platform));
    expect(
      profileWindowShortcutIndex(press("Digit2", { control: true, shift: true }), platform),
    ).toBe(1);
    expect(
      profileWindowShortcutIndex(press("Digit2", { alt: true, shift: true }), platform),
    ).toBeNull();
  });

  it("follow the chords the renderer reported", () => {
    setShellChords([
      {
        command: "window.profile.2",
        key: "9",
        control: true,
        alt: false,
        meta: false,
        shift: false,
      },
    ]);
    expect(profileWindowShortcutIndex(press("Digit9", { control: true }), "linux")).toBe(1);
    expect(
      profileWindowShortcutIndex(press("Digit2", { alt: true, shift: true }), "linux"),
    ).toBeNull();
  });

  it("ignore repeats and releases", () => {
    const chord = { alt: true, shift: true };
    expect(
      profileWindowShortcutIndex(press("Digit1", { ...chord, isAutoRepeat: true }), "linux"),
    ).toBeNull();
    expect(profileWindowShortcutIndex(press("Digit1", chord, "keyUp"), "linux")).toBeNull();
  });
});

describe("menuAccelerator", () => {
  it("writes the defaults as the menu always did", () => {
    const accelerators = (platform: NodeJS.Platform) =>
      Object.fromEntries(
        defaultShellChords(platform)
          .filter((chord) => !chord.command.startsWith("window.profile."))
          .map((chord) => [`${chord.command} ${chord.key}`, menuAccelerator(chord, platform)]),
      );
    for (const platform of ["darwin", "linux"] as const) {
      expect(accelerators(platform)).toEqual({
        "settings.open ,": "CmdOrCtrl+,",
        "zoom.in =": "CmdOrCtrl+=",
        "zoom.in +": "CmdOrCtrl+Plus",
        "zoom.out -": "CmdOrCtrl+-",
        "zoom.reset 0": "CmdOrCtrl+0",
      });
    }
  });

  it("shows a profile window chord for the platform", () => {
    const chord = (platform: NodeJS.Platform) =>
      defaultShellChords(platform).find((entry) => entry.command === "window.profile.2")!;
    expect(menuAccelerator(chord("linux"), "linux")).toBe("Alt+Shift+2");
    expect(menuAccelerator(chord("darwin"), "darwin")).toBe("Control+Shift+2");
  });

  it("has none for a key with no modifier", () => {
    expect(
      menuAccelerator({ key: "k", control: false, alt: false, meta: false, shift: false }, "linux"),
    ).toBeNull();
  });
});
