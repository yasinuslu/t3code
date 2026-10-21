import { describe, expect, it } from "vite-plus/test";

import {
  GROW_KEY_CODES,
  GROW_KEY_HELP,
  growKeyAction,
  type GrowKeyAction,
  type GrowKeyState,
} from "./grow.keys";

const press = (code: string, modifiers: Record<string, boolean> = {}) => ({
  code,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
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

const act = (code: string, overrides: Partial<GrowKeyState> = {}, modifiers = {}) =>
  growKeyAction(press(code, modifiers), state(overrides));

describe("growKeyAction", () => {
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
    expect(growKeyAction({ ...press("KeyW"), key: "ğ" } as never, state())).toEqual({
      type: "step",
      direction: -1,
    });
  });

  it("leaves plain keys to a text field and to the live app, and takes them with Alt", () => {
    expect(act("KeyS", { typing: true })).toBeNull();
    expect(act("KeyS", { inLive: true })).toBeNull();
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
    for (const code of ["KeyA", "KeyD", "KeyE", "KeyX", "KeyR", "Digit2", "Digit3", "Digit4"]) {
      expect(act(code, manager)).toBeNull();
    }
    expect(act("KeyS", manager)).toEqual({ type: "step", direction: 1 });
    expect(act("KeyT", manager)).toEqual({ type: "manager" });
  });

  it("switches profile with V, and back with Shift+V", () => {
    expect(act("KeyV")).toEqual({ type: "profile", direction: 1 });
    expect(act("KeyV", {}, { shiftKey: true })).toEqual({ type: "profile", direction: -1 });
  });

  it("binds only keys under a left hand on WASD", () => {
    const leftHand = /^(Key[QWERTASDFGZXCV]|Digit[1-5])$/;
    for (const code of GROW_KEY_CODES) expect(code).toMatch(leftHand);
    for (const code of ["KeyJ", "KeyK", "KeyO", "KeyP", "ArrowDown", "Enter"]) {
      expect(act(code)).toBeNull();
    }
  });

  it("lists in the shortcut sheet exactly the keys that act, each with its own action", () => {
    const codeOf = (key: string) => {
      const name = key.replace(/^Shift\+/, "");
      return /^[0-9]$/.test(name) ? `Digit${name}` : `Key${name}`;
    };
    const listed = new Set<string>();
    for (const { entries } of GROW_KEY_HELP) {
      for (const entry of entries) {
        for (const key of entry.keys) {
          const action: GrowKeyAction | null = act(
            codeOf(key),
            {},
            {
              shiftKey: key.startsWith("Shift+"),
            },
          );
          expect(action?.type, key).toBe(entry.action);
          listed.add(codeOf(key));
        }
      }
    }
    expect(listed).toEqual(new Set(GROW_KEY_CODES));
  });
});
