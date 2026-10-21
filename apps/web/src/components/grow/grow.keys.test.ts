import { describe, expect, it } from "vite-plus/test";

import { GROW_KEY_HELP, growKeyAction, type GrowKeyState } from "./grow.keys";

const key = (value: string, modifiers: Record<string, boolean> = {}) => ({
  key: value,
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

const deck = (item: GrowKeyState["item"] = returnItem()): GrowKeyState => ({
  conversationOpen: false,
  item,
});

describe("growKeyAction", () => {
  it("maps each Grow shortcut to its action on a return", () => {
    const actions = [
      "s",
      "d",
      "w",
      "x",
      "a",
      "c",
      "v",
      "Enter",
      "e",
      "q",
      "z",
      "f",
      "/",
      "g",
      "t",
      "r",
    ].map((value) => growKeyAction(key(value), deck())?.type);
    expect(actions).toEqual([
      "ship",
      "done",
      "whatIf",
      "letGo",
      "askProof",
      "openThread",
      "play",
      "play",
      "step",
      "step",
      "undo",
      "search",
      "search",
      "toggleProjects",
      "manager",
      "profile",
    ]);
  });

  it("keeps every letter under the left hand", () => {
    const leftHand = new Set("qwertasdfgzxcvb");
    const bound = "sdwxacvefqzgtr"
      .split("")
      .filter((value) => growKeyAction(key(value), deck()) !== null);
    expect(bound).toHaveLength(14);
    for (const value of bound) expect(leftHand.has(value)).toBe(true);
  });

  it("frees the keys the right hand used to need", () => {
    for (const value of ["o", "p", "m", "u"]) {
      expect(growKeyAction(key(value), deck())).toBeNull();
    }
  });

  it("moves between cards with q and e, and still with j, k and the arrows", () => {
    expect(growKeyAction(key("e"), deck())).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("q"), deck())).toEqual({ type: "step", direction: -1 });
    expect(growKeyAction(key("j"), deck())).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("ArrowDown"), deck())).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("k"), deck())).toEqual({ type: "step", direction: -1 });
    expect(growKeyAction(key("ArrowUp"), deck())).toEqual({ type: "step", direction: -1 });
    expect(growKeyAction(key("e"), deck(null))).toEqual({ type: "step", direction: 1 });
  });

  it("switches profile with r, and back with Shift+r, from every view", () => {
    for (const state of [
      deck(),
      deck(null),
      { conversationOpen: false, managerOpen: true, item: returnItem() },
      { conversationOpen: true, item: returnItem() },
    ]) {
      expect(growKeyAction(key("r"), state)).toEqual({ type: "profile", direction: 1 });
      expect(growKeyAction(key("R"), state)).toEqual({ type: "profile", direction: -1 });
    }
    expect(growKeyAction(key("r", { altKey: true }), deck())).toBeNull();
  });

  it("leaves a key alone when its action does not apply", () => {
    expect(growKeyAction(key("s"), deck(returnItem({ shippable: false })))).toBeNull();
    expect(growKeyAction(key("a"), deck(returnItem({ thread: { statusProof: {} } })))).toBeNull();
    expect(growKeyAction(key("v"), deck(returnItem({ playUrl: null })))).toBeNull();
    expect(growKeyAction(key("s"), deck(returnItem({ kind: "urgent" })))).toBeNull();
    expect(growKeyAction(key("x"), deck(returnItem({ kind: "letGo" })))).toBeNull();
    expect(growKeyAction(key("s"), deck(null))).toBeNull();
  });

  it("ignores keys held with a modifier or typed through an input method", () => {
    expect(growKeyAction(key("s", { ctrlKey: true }), deck())).toBeNull();
    expect(growKeyAction(key("s", { metaKey: true }), deck())).toBeNull();
    expect(growKeyAction(key("s", { altKey: true }), deck())).toBeNull();
    expect(growKeyAction(key("s", { isComposing: true }), deck())).toBeNull();
  });

  it("brings up the manager with t from the deck, a conversation or the manager itself", () => {
    expect(growKeyAction(key("t"), deck())).toEqual({ type: "manager" });
    expect(growKeyAction(key("t"), deck(null))).toEqual({ type: "manager" });
    expect(growKeyAction(key("t"), { conversationOpen: true, item: returnItem() })).toEqual({
      type: "manager",
    });
    expect(growKeyAction(key("t", { ctrlKey: true }), deck())).toBeNull();
  });

  it("keeps the item's keys off while the manager shows, and q and e go back to the deck", () => {
    const manager: GrowKeyState = {
      conversationOpen: false,
      managerOpen: true,
      item: returnItem(),
    };
    expect(growKeyAction(key("e"), manager)).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("q"), manager)).toEqual({ type: "step", direction: -1 });
    for (const value of ["s", "d", "w", "x", "a", "c", "v", "Enter", "z", "g", "f"]) {
      expect(growKeyAction(key(value), manager)).toBeNull();
    }
  });

  it("keeps the deck's keys off while a conversation shows, and c goes back", () => {
    const conversation: GrowKeyState = { conversationOpen: true, item: returnItem() };
    expect(growKeyAction(key("c"), conversation)).toEqual({ type: "closeThread" });
    for (const value of ["s", "d", "w", "x", "a", "e", "q", "j", "k", "v", "Enter"]) {
      expect(growKeyAction(key(value), conversation)).toBeNull();
    }
  });

  it("has nothing for c to open while the conversation already shows beside the item", () => {
    const beside: GrowKeyState = { ...deck(), conversationShown: true };
    expect(growKeyAction(key("c"), beside)).toBeNull();
    expect(growKeyAction(key("j"), beside)).toEqual({ type: "step", direction: 1 });
  });

  it("lists in the shortcut sheet exactly the keys that act, each with its own action", () => {
    for (const { entries } of GROW_KEY_HELP) {
      for (const { keys, action, label } of entries) {
        for (const shown of keys) {
          const value = shown.startsWith("Shift+") ? shown.slice(6) : shown.toLowerCase();
          expect(growKeyAction(key(value), deck())?.type, `${label}: ${shown}`).toBe(action);
        }
      }
    }
    const listed = GROW_KEY_HELP.flatMap(({ entries }) => entries.flatMap(({ keys }) => keys));
    const letters = new Set(listed.map((shown) => shown.slice(-1).toLowerCase()));
    expect([...letters].toSorted()).toEqual([..."sdwxacvefqzgtr"].toSorted());
  });
});
