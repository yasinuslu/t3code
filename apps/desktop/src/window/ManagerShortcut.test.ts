import { describe, expect, it } from "vite-plus/test";

import { isOpenManagerShortcut } from "./ManagerShortcut.ts";

const input = (overrides: Partial<Parameters<typeof isOpenManagerShortcut>[0]> = {}) => ({
  type: "keyDown" as const,
  key: "e",
  meta: true,
  control: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...overrides,
});

describe("isOpenManagerShortcut", () => {
  it("is Cmd+E on macOS, a left-hand chord", () => {
    expect(isOpenManagerShortcut(input(), "darwin")).toBe(true);
    expect(isOpenManagerShortcut(input({ key: "E" }), "darwin")).toBe(true);
  });

  it("ignores other chords, repeats and key releases", () => {
    expect(isOpenManagerShortcut(input({ shift: true }), "darwin")).toBe(false);
    expect(isOpenManagerShortcut(input({ alt: true }), "darwin")).toBe(false);
    expect(isOpenManagerShortcut(input({ key: "r" }), "darwin")).toBe(false);
    expect(isOpenManagerShortcut(input({ isAutoRepeat: true }), "darwin")).toBe(false);
    expect(isOpenManagerShortcut(input({ type: "keyUp" }), "darwin")).toBe(false);
  });

  it("leaves Ctrl+E to terminals on Windows and Linux", () => {
    const ctrlE = input({ meta: false, control: true });
    expect(isOpenManagerShortcut(ctrlE, "linux")).toBe(false);
    expect(
      isOpenManagerShortcut(input({ key: "m", meta: false, control: true, alt: true }), "linux"),
    ).toBe(true);
  });
});
