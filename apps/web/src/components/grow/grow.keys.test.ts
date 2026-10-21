import { describe, expect, it } from "vite-plus/test";

import { growKeyAction, type GrowKeyState } from "./grow.keys";

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
    const actions = ["s", "d", "w", "r", "x", "a", "o", "p", "Enter", "j", "k", "u", "/", "e"].map(
      (value) => growKeyAction(key(value), deck())?.type,
    );
    expect(actions).toEqual([
      "ship",
      "done",
      "whatIf",
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
      "toggleProjects",
    ]);
  });

  it("moves between cards with j, k and the arrows", () => {
    expect(growKeyAction(key("j"), deck())).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("ArrowDown"), deck())).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("k"), deck())).toEqual({ type: "step", direction: -1 });
    expect(growKeyAction(key("ArrowUp"), deck())).toEqual({ type: "step", direction: -1 });
    expect(growKeyAction(key("j"), deck(null))).toEqual({ type: "step", direction: 1 });
  });

  it("leaves a key alone when its action does not apply", () => {
    expect(growKeyAction(key("s"), deck(returnItem({ shippable: false })))).toBeNull();
    expect(growKeyAction(key("a"), deck(returnItem({ thread: { statusProof: {} } })))).toBeNull();
    expect(growKeyAction(key("p"), deck(returnItem({ playUrl: null })))).toBeNull();
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

  it("brings up the manager with m from the deck, a conversation or the manager itself", () => {
    expect(growKeyAction(key("m"), deck())).toEqual({ type: "manager" });
    expect(growKeyAction(key("m"), deck(null))).toEqual({ type: "manager" });
    expect(growKeyAction(key("m"), { conversationOpen: true, item: returnItem() })).toEqual({
      type: "manager",
    });
    expect(growKeyAction(key("m", { ctrlKey: true }), deck())).toBeNull();
  });

  it("keeps the item's keys off while the manager shows, and j and k go back to the deck", () => {
    const manager: GrowKeyState = {
      conversationOpen: false,
      managerOpen: true,
      item: returnItem(),
    };
    expect(growKeyAction(key("j"), manager)).toEqual({ type: "step", direction: 1 });
    expect(growKeyAction(key("k"), manager)).toEqual({ type: "step", direction: -1 });
    for (const value of ["s", "d", "w", "x", "a", "o", "p", "Enter", "u", "e"]) {
      expect(growKeyAction(key(value), manager)).toBeNull();
    }
  });

  it("keeps the deck's keys off while a conversation shows, and o goes back", () => {
    const conversation: GrowKeyState = { conversationOpen: true, item: returnItem() };
    expect(growKeyAction(key("o"), conversation)).toEqual({ type: "closeThread" });
    for (const value of ["s", "d", "w", "x", "a", "j", "k", "p", "Enter"]) {
      expect(growKeyAction(key(value), conversation)).toBeNull();
    }
  });

  it("has nothing for o to open while the conversation already shows beside the item", () => {
    const beside: GrowKeyState = { ...deck(), conversationShown: true };
    expect(growKeyAction(key("o"), beside)).toBeNull();
    expect(growKeyAction(key("j"), beside)).toEqual({ type: "step", direction: 1 });
  });
});
