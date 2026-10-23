import { GROW_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  GROW_COMMAND_LABELS,
  GROW_KEY_HELP,
  growKeyAction,
  type GrowKeyAction,
  type GrowKeyState,
} from "./grow.keys";

const LINUX = "Linux x86_64";
const MAC = "MacIntel";

const press = (code: string, modifiers: Record<string, boolean> = {}) => ({
  code,
  key: /^(Key|Digit)/.test(code) ? "x" : code,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: true,
  isComposing: false,
  ...modifiers,
});

const returnItem = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: "return",
    shippable: true,
    playUrl: "https://preview.example",
    thread: { statusProof: null },
    ...overrides,
  }) as unknown as NonNullable<GrowKeyState["item"]>;

const state = (overrides: Partial<GrowKeyState> = {}): GrowKeyState => ({
  typing: false,
  inLive: false,
  managerOpen: false,
  item: returnItem(),
  ...overrides,
});

/** A key as the default keybindings read it on a PC (Alt) unless `mac` (Control). */
const act = (
  code: string,
  overrides: Partial<GrowKeyState> = {},
  modifiers: Record<string, boolean> = {},
  mac = false,
) =>
  growKeyAction(
    press(code, mac ? { altKey: false, ctrlKey: true, ...modifiers } : modifiers),
    state(overrides),
    DEFAULT_RESOLVED_KEYBINDINGS,
    mac ? MAC : LINUX,
  );

describe("growKeyAction on Windows and Linux (Alt)", () => {
  it("steps threads with W and S and pages with A and D", () => {
    expect(act("KeyW")).toEqual({ type: "step", direction: -1 });
    expect(act("KeyS")).toEqual({ type: "step", direction: 1 });
    expect(act("KeyA")).toEqual({ type: "page", direction: -1 });
    expect(act("KeyD")).toEqual({ type: "page", direction: 1 });
  });

  it("jumps to a place with the number keys, and Q goes back", () => {
    expect(["Digit1", "Digit2", "Digit3", "Digit4"].map((code) => act(code))).toEqual([
      { type: "zone", zone: "threads" },
      { type: "zone", zone: "presentation" },
      { type: "zone", zone: "live" },
      { type: "zone", zone: "chat" },
    ]);
    expect(act("KeyQ")).toEqual({ type: "back" });
  });

  it("reads the physical key, so the layout under it does not matter", () => {
    // A Turkish F layout puts other letters on these keys; the place is what counts.
    expect(
      growKeyAction({ ...press("KeyW"), key: "ğ" }, state(), DEFAULT_RESOLVED_KEYBINDINGS, LINUX),
    ).toEqual({ type: "step", direction: -1 });
  });

  it("never takes a plain key, so inline components keep them, and takes Alt+key everywhere", () => {
    expect(act("KeyS", {}, { altKey: false })).toBeNull();
    expect(act("KeyS", { typing: true }, { altKey: false })).toBeNull();
    expect(act("KeyS", { inLive: true }, { altKey: false })).toBeNull();
    expect(act("KeyS", { typing: true }, { altKey: true })).toEqual({ type: "step", direction: 1 });
    expect(act("Digit1", { inLive: true }, { altKey: true })).toEqual({
      type: "zone",
      zone: "threads",
    });
  });

  it("ignores Ctrl and Cmd chords and keys typed through an input method", () => {
    expect(act("KeyS", {}, { ctrlKey: true })).toBeNull();
    expect(act("KeyS", {}, { metaKey: true })).toBeNull();
    expect(act("KeyS", {}, { isComposing: true })).toBeNull();
  });

  it("has no live place or reload for an item without a live app", () => {
    expect(act("Digit3", { item: returnItem({ playUrl: null }) })).toBeNull();
    expect(act("KeyR", { item: returnItem({ playUrl: null }) })).toBeNull();
    expect(act("KeyR")).toEqual({ type: "reload" });
  });

  it("keeps the card's moves to the cards they apply to", () => {
    expect(act("KeyE")).toEqual({ type: "main" });
    expect(act("KeyX")).toEqual({ type: "settle" });
    expect(act("KeyX", {}, { shiftKey: true })).toEqual({ type: "supersede" });
    const working = returnItem({ kind: "working" });
    expect(act("KeyE", { item: working })).toBeNull();
    expect(act("KeyX", { item: working })).toBeNull();
    expect(act("KeyX", { item: working }, { shiftKey: true })).toBeNull();
    const settled = returnItem({ kind: "letGo" });
    expect(act("KeyX", { item: settled })).toBeNull();
    expect(act("KeyX", { item: settled }, { shiftKey: true })).toEqual({ type: "supersede" });
  });

  it("keeps the item's keys off while the manager shows; moving takes the screen back", () => {
    const manager = { managerOpen: true };
    for (const code of ["KeyA", "KeyD", "KeyE", "KeyX", "KeyR", "Digit2", "Digit3"]) {
      expect(act(code, manager)).toBeNull();
    }
    expect(act("KeyS", manager)).toEqual({ type: "step", direction: 1 });
    expect(act("KeyT", manager)).toEqual({ type: "manager" });
    expect(act("Digit4", manager)).toEqual({ type: "zone", zone: "chat" });
  });

  it("leaves the profile keys to the global profile.next / profile.previous", () => {
    expect(act("KeyV")).toBeNull();
    expect(act("KeyV", {}, { shiftKey: true })).toBeNull();
  });

  it("binds only keys under a left hand on WASD", () => {
    for (const code of ["KeyJ", "KeyK", "KeyO", "KeyP", "ArrowDown", "Enter"]) {
      expect(act(code)).toBeNull();
    }
  });
});

describe("growKeyAction on a Mac (Control)", () => {
  it("holds the same keys with Control, and not with Option", () => {
    expect(act("KeyW", {}, {}, true)).toEqual({ type: "step", direction: -1 });
    expect(act("KeyS", {}, {}, true)).toEqual({ type: "step", direction: 1 });
    expect(act("Digit2", {}, {}, true)).toEqual({ type: "zone", zone: "presentation" });
    expect(act("KeyX", {}, { shiftKey: true }, true)).toEqual({ type: "supersede" });
    expect(act("KeyW", {}, { altKey: true, ctrlKey: false }, true)).toBeNull();
    expect(act("KeyW", {}, { ctrlKey: false, altKey: false }, true)).toBeNull();
    // Command is the app's own modifier.
    expect(act("KeyW", {}, { metaKey: true }, true)).toBeNull();
  });

  it("moves the card's main move off Ctrl+E, which is the manager and end-of-line", () => {
    expect(act("KeyE", {}, {}, true)).toBeNull();
    expect(act("KeyE", {}, { shiftKey: true }, true)).toEqual({ type: "main" });
  });

  it("leaves a text field its emacs editing keys, and takes the rest while typing", () => {
    for (const code of ["KeyA", "KeyD", "KeyF", "KeyT"]) {
      expect(act(code, { typing: true }, {}, true), code).toBeNull();
      expect(act(code, { typing: false }, {}, true), code).not.toBeNull();
    }
    expect(act("KeyW", { typing: true }, {}, true)).toEqual({ type: "step", direction: -1 });
    expect(act("KeyS", { typing: true }, {}, true)).toEqual({ type: "step", direction: 1 });
    expect(act("Digit1", { typing: true }, {}, true)).toEqual({ type: "zone", zone: "threads" });
  });

  it("does not keep a PC's Control+letter from text on Linux", () => {
    expect(act("KeyA", { typing: true }, { altKey: true })).toEqual({
      type: "page",
      direction: -1,
    });
  });
});

describe("growKeyAction follows the keybindings", () => {
  it("takes a rebound key and drops the old one", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "alt+i", command: "grow.step.previous" },
      { key: "alt+k", command: "grow.step.next" },
    ]);
    const run = (code: string) => growKeyAction(press(code), state(), keybindings, LINUX);
    expect(run("KeyI")).toEqual({ type: "step", direction: -1 });
    expect(run("KeyK")).toEqual({ type: "step", direction: 1 });
    expect(run("KeyW")).toBeNull();
  });

  it("takes any chord, not only the Grow modifier", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "ctrl+shift+arrowdown", command: "grow.step.next" }, // commit-check:allow
    ]);
    expect(
      growKeyAction(
        {
          ...press("ArrowDown", { altKey: false, ctrlKey: true, shiftKey: true }),
          key: "ArrowDown",
        },
        state(),
        keybindings,
        LINUX,
      ),
    ).toEqual({ type: "step", direction: 1 });
  });

  it("does nothing for a command that is not Grow's", () => {
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "alt+w", command: "diff.toggle" },
    ]);
    expect(growKeyAction(press("KeyW"), state(), keybindings, LINUX)).toBeNull();
  });
});

describe("the defaults", () => {
  const keysOf = (command: string) =>
    DEFAULT_RESOLVED_KEYBINDINGS.filter((rule) => rule.command === command);

  it("have an Alt rule and a Control rule for every Grow command, each for its own platform", () => {
    for (const command of GROW_KEYBINDING_COMMANDS) {
      const rules = keysOf(command);
      expect(rules.length, command).toBe(2);
      expect(rules.filter((rule) => rule.shortcut.altKey).length, command).toBe(1);
      expect(rules.filter((rule) => rule.shortcut.ctrlKey).length, command).toBe(1);
    }
  });

  it("keep Windows and Linux on Alt+key, as they always were", () => {
    const expected: Record<string, string> = {
      "grow.step.previous": "w",
      "grow.step.next": "s",
      "grow.page.previous": "a",
      "grow.page.next": "d",
      "grow.zone.threads": "1",
      "grow.zone.presentation": "2",
      "grow.zone.live": "3",
      "grow.zone.chat": "4",
      "grow.back": "q",
      "grow.manager": "t",
      "grow.main": "e",
      "grow.settle": "x",
      "grow.undo": "z",
      "grow.reload": "r",
      "grow.search": "f",
      "grow.toggleProjects": "g",
    };
    for (const [command, key] of Object.entries(expected)) {
      const alt = keysOf(command).find((rule) => rule.shortcut.altKey);
      expect(alt?.shortcut, command).toMatchObject({ key, altKey: true, ctrlKey: false });
    }
  });

  it("never put a Mac Grow key on a chord another command owns in the same place", () => {
    const grow = new Set<string>(GROW_KEYBINDING_COMMANDS);
    const mac = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (rule) =>
        grow.has(rule.command) &&
        rule.shortcut.ctrlKey &&
        // Ctrl+S is "next thread" in Grow and the sidebar elsewhere: Grow's rule outranks it.
        !(rule.shortcut.key === "s" && rule.command === "grow.step.next"),
    );
    const others = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (rule) => !grow.has(rule.command) && rule.shortcut.ctrlKey && !rule.shortcut.altKey,
    );
    for (const rule of mac) {
      const clash = others.find(
        (other) =>
          other.shortcut.key === rule.shortcut.key &&
          other.shortcut.shiftKey === rule.shortcut.shiftKey,
      );
      expect(clash?.command ?? null, `${rule.command} vs ${clash?.command}`).toBeNull();
    }
  });

  it("are all listed in the shortcut sheet, once", () => {
    const listed = GROW_KEY_HELP.flatMap(({ entries }) => entries.flatMap((e) => e.commands));
    const grow = listed.filter((command) => command.startsWith("grow."));
    expect(new Set(grow)).toEqual(new Set(GROW_KEYBINDING_COMMANDS));
    expect(grow.length).toBe(GROW_KEYBINDING_COMMANDS.length);
  });

  it("make every Grow command act, on both platforms", () => {
    for (const mac of [false, true]) {
      for (const command of GROW_KEYBINDING_COMMANDS) {
        const rule = keysOf(command).find((entry) => (entry.shortcut.ctrlKey ? mac : !mac))!;
        const code = /^\d$/.test(rule.shortcut.key)
          ? `Digit${rule.shortcut.key}`
          : `Key${rule.shortcut.key.toUpperCase()}`;
        const action: GrowKeyAction | null = growKeyAction(
          press(code, {
            altKey: rule.shortcut.altKey,
            ctrlKey: rule.shortcut.ctrlKey,
            shiftKey: rule.shortcut.shiftKey,
          }),
          state(),
          DEFAULT_RESOLVED_KEYBINDINGS,
          mac ? MAC : LINUX,
        );
        expect(action, `${command} on ${mac ? "mac" : "linux"}`).not.toBeNull();
        expect(GROW_COMMAND_LABELS[command]).toBeTruthy();
      }
    }
  });
});
