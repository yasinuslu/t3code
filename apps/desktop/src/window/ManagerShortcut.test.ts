import { describe, expect, it } from "vite-plus/test";

import { growKeyAction, isManagerShortcut, managerChordAccelerator } from "./ManagerShortcut.ts";

const chord = { key: " ", control: true, alt: true, meta: false, shift: false };

const input = (overrides: Partial<Parameters<typeof isManagerShortcut>[0]> = {}) => ({
  type: "keyDown" as const,
  // Option+Space types a no-break space on macOS; the physical key still matches.
  key: " ",
  code: "Space",
  meta: false,
  control: true,
  alt: true,
  shift: false,
  isAutoRepeat: false,
  ...overrides,
});

describe("managerChordAccelerator", () => {
  it("names the default chord the way Electron registers it", () => {
    expect(managerChordAccelerator(chord, "darwin")).toBe("Control+Alt+Space");
    expect(
      managerChordAccelerator(
        { ...chord, key: "e", control: false, alt: false, meta: true },
        "darwin",
      ),
    ).toBe("Command+E");
    expect(managerChordAccelerator({ ...chord, key: "f2", alt: false }, "linux")).toBe(
      "Control+F2",
    );
  });

  it("refuses a bare key, which would take it from every app", () => {
    expect(managerChordAccelerator({ ...chord, control: false, alt: false }, "darwin")).toBeNull();
    expect(
      managerChordAccelerator({ ...chord, shift: true, control: false, alt: false }, "linux"),
    ).toBeNull();
  });
});

describe("isManagerShortcut", () => {
  it("matches the reported chord by its physical key", () => {
    expect(isManagerShortcut(input(), chord)).toBe(true);
  });

  it("ignores other chords, repeats, key releases and an unreported chord", () => {
    expect(isManagerShortcut(input({ shift: true }), chord)).toBe(false);
    expect(isManagerShortcut(input({ alt: false }), chord)).toBe(false);
    expect(isManagerShortcut(input({ code: "KeyM", key: "m" }), chord)).toBe(false);
    expect(isManagerShortcut(input({ isAutoRepeat: true }), chord)).toBe(false);
    expect(isManagerShortcut(input({ type: "keyUp" }), chord)).toBe(false);
    expect(isManagerShortcut(input(), null)).toBe(false);
  });
});

describe("growKeyAction", () => {
  const press = (code: string, overrides: Partial<Parameters<typeof growKeyAction>[0]> = {}) =>
    input({ code, key: "x", control: false, alt: true, ...overrides });

  it("hands Grow's keys held with Alt to the renderer, with Shift", () => {
    expect(growKeyAction(press("KeyS"))).toBe("grow-key:KeyS:0");
    expect(growKeyAction(press("Digit2"))).toBe("grow-key:Digit2:0");
    expect(growKeyAction(press("KeyX", { shift: true }))).toBe("grow-key:KeyX:1");
  });

  it("leaves the page its plain keys, other chords, other keys and repeats", () => {
    expect(growKeyAction(press("KeyS", { alt: false }))).toBeNull();
    expect(growKeyAction(press("KeyS", { control: true }))).toBeNull();
    expect(growKeyAction(press("KeyS", { meta: true }))).toBeNull();
    expect(growKeyAction(press("KeyJ"))).toBeNull();
    expect(growKeyAction(press("KeyS", { isAutoRepeat: true }))).toBeNull();
    expect(growKeyAction(press("KeyS", { type: "keyUp" }))).toBeNull();
  });
});
