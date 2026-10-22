import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveShortcutCommand } from "../keybindings";
import { isInlineComponentEvent } from "./editableFocus";

function node(localName: string, options: { inShadow?: boolean; editable?: boolean } = {}) {
  return {
    localName,
    getRootNode: () => (options.inShadow ? { host: {} } : {}),
    matches: () => options.editable === true,
  };
}

const keyEvent = (key: string, path: unknown[], modifiers: Record<string, boolean> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
  composedPath: () => path,
});

describe("isInlineComponentEvent", () => {
  it("flags an event whose path contains a t3-* host", () => {
    const path = [node("input", { inShadow: true }), node("t3-slider"), node("div")];
    expect(isInlineComponentEvent(keyEvent("a", path))).toBe(true);
  });

  it("flags an editable control inside a shadow root even without a t3-* host", () => {
    const path = [node("input", { inShadow: true, editable: true }), node("custom-form")];
    expect(isInlineComponentEvent(keyEvent("a", path))).toBe(true);
  });

  it("leaves a plain light-DOM input and ordinary elements alone", () => {
    expect(isInlineComponentEvent(keyEvent("a", [node("input", { editable: true })]))).toBe(false);
    expect(isInlineComponentEvent(keyEvent("a", [node("button"), node("div")]))).toBe(false);
  });
});

describe("shortcut resolution inside inline components", () => {
  const platform = "Linux";
  vi.stubGlobal("navigator", { platform });
  const host = [node("t3-ranker")];

  it("ignores bare and Shift-only keys from a t3-* element", () => {
    const usage = { context: { usagePageOpen: true }, platform };
    expect(
      resolveShortcutCommand(keyEvent("c", host), DEFAULT_RESOLVED_KEYBINDINGS, usage),
    ).toBeNull();
    expect(
      resolveShortcutCommand(
        keyEvent("c", host, { shiftKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        usage,
      ),
    ).toBeNull();
  });

  it("still resolves modifier chords from a t3-* element", () => {
    expect(
      resolveShortcutCommand(keyEvent("b", host, { ctrlKey: true }), DEFAULT_RESOLVED_KEYBINDINGS, {
        platform,
      }),
    ).toBe("sidebar.toggle");
  });
});

describe("default keybindings", () => {
  it("has no modifier-less binding", () => {
    const bare = DEFAULT_RESOLVED_KEYBINDINGS.filter(({ shortcut }) => {
      const hasModifier =
        shortcut.modKey || shortcut.ctrlKey || shortcut.metaKey || shortcut.altKey;
      return !hasModifier && shortcut.key !== "escape";
    });
    expect(bare.map(({ command }) => command)).toEqual([]);
  });

  it("scopes every Escape binding to a dialog-like context", () => {
    const escapes = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      ({ shortcut }) => shortcut.key === "escape",
    );
    for (const binding of escapes) expect(binding.whenAst).toBeDefined();
  });
});
