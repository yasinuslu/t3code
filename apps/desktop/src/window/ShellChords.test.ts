import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  defaultShellChords,
  growCommandOfInput,
  menuAccelerator,
  profileWindowShortcutIndex,
  setShellChords,
  shellCommandsOfInput,
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
afterEach(() => setShellChords(defaultShellChords("linux")));

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

  it("leave plain Alt+digit to Grow's places", () => {
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

describe("growCommandOfInput", () => {
  const grow = (key: string, mods: { control?: boolean; alt?: boolean; shift?: boolean }) => ({
    command: "grow.step.next",
    key,
    control: false,
    alt: false,
    meta: false,
    shift: false,
    ...mods,
  });

  it("names the Grow command a reported chord stands for, and nothing before one is reported", () => {
    expect(growCommandOfInput(press("KeyS", { alt: true }), "linux")).toBeNull();
    setShellChords([grow("s", { alt: true })]);
    expect(growCommandOfInput(press("KeyS", { alt: true }), "linux")).toBe("grow.step.next");
    expect(growCommandOfInput(press("KeyS"), "linux")).toBeNull();
    expect(growCommandOfInput(press("KeyD", { alt: true }), "linux")).toBeNull();
  });

  it("keeps a Mac text field's Control+letter editing keys with the page", () => {
    setShellChords([
      { ...grow("s", { control: true }) },
      { ...grow("a", { control: true }), command: "grow.page.previous" },
    ]);
    expect(growCommandOfInput(press("KeyS", { control: true }), "darwin")).toBe("grow.step.next");
    expect(growCommandOfInput(press("KeyA", { control: true }), "darwin")).toBeNull();
    expect(growCommandOfInput(press("KeyA", { control: true }), "linux")).toBe(
      "grow.page.previous",
    );
  });

  it("reads the digits by place", () => {
    setShellChords([{ ...grow("1", { alt: true }), command: "grow.zone.threads" }]);
    expect(shellCommandsOfInput(press("Digit1", { alt: true }), "linux")).toEqual([
      "grow.zone.threads",
    ]);
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
