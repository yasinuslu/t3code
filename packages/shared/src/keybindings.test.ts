import type { KeybindingWhenNode } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_RESOLVED_KEYBINDINGS } from "./keybindings.ts";

function identifiersOf(node: KeybindingWhenNode | undefined, into: Set<string>): Set<string> {
  if (!node) return into;
  switch (node.type) {
    case "identifier":
      if (node.name !== "true" && node.name !== "false") into.add(node.name);
      break;
    case "not":
      identifiersOf(node.node, into);
      break;
    case "and":
    case "or":
      identifiersOf(node.left, into);
      identifiersOf(node.right, into);
      break;
  }
  return into;
}

function evaluate(node: KeybindingWhenNode | undefined, context: Record<string, boolean>): boolean {
  if (!node) return true;
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return context[node.name] ?? false;
    case "not":
      return !evaluate(node.node, context);
    case "and":
      return evaluate(node.left, context) && evaluate(node.right, context);
    case "or":
      return evaluate(node.left, context) || evaluate(node.right, context);
  }
}

/**
 * Pairs that share a chord on purpose: the later rule takes over while its context holds,
 * and that context is a mode of its own (a picker, a terminal) rather than a place a
 * user also expects the earlier command.
 */
const INTENDED_OVERLAPS: ReadonlyArray<readonly [string, string]> = [
  // While the model picker is open, Mod+1..9 picks a model instead of jumping to a thread.
  ["thread.jump.", "modelPicker.jump."],
];

/** Contexts that never hold together, so rules split by them do not collide. */
const EXCLUSIVE_CONTEXTS: ReadonlyArray<readonly [string, string]> = [
  // A draft thread has not started a turn yet.
  ["draftThreadRoute", "turnRunning"],
];

const possible = (context: Record<string, boolean>) =>
  EXCLUSIVE_CONTEXTS.every(([a, b]) => !(context[a] && context[b]));

const isIntended = (earlier: string, later: string) =>
  INTENDED_OVERLAPS.some(([a, b]) => earlier.startsWith(a) && later.startsWith(b));

/** Two default rules on one physical chord whose contexts can both hold, per platform. */
function defaultConflicts(mac: boolean): string[] {
  const rules = DEFAULT_RESOLVED_KEYBINDINGS.map((rule) => {
    const { key, metaKey, ctrlKey, shiftKey, altKey, modKey } = rule.shortcut;
    const chord = [
      metaKey || (modKey && mac) ? "meta" : "",
      ctrlKey || (modKey && !mac) ? "ctrl" : "",
      altKey ? "alt" : "",
      shiftKey ? "shift" : "",
      key,
    ]
      .filter(Boolean)
      .join("+");
    return { rule, chord };
  });
  const conflicts: string[] = [];
  for (const [index, earlier] of rules.entries()) {
    for (const later of rules.slice(index + 1)) {
      if (earlier.chord !== later.chord) continue;
      if (earlier.rule.command === later.rule.command) continue;
      if (isIntended(earlier.rule.command, later.rule.command)) continue;
      const names = [
        ...identifiersOf(
          later.rule.whenAst,
          identifiersOf(earlier.rule.whenAst, new Set<string>()),
        ),
      ].filter((name) => name !== "isMac" && name !== "isDesktop" && name !== "isWeb");
      const overlaps = [true, false].some((desktop) =>
        Array.from({ length: 2 ** names.length }, (_, mask) => mask).some((mask) => {
          const context: Record<string, boolean> = {
            isMac: mac,
            isDesktop: desktop,
            isWeb: !desktop,
          };
          names.forEach((name, bit) => (context[name] = (mask & (1 << bit)) !== 0));
          return (
            possible(context) &&
            evaluate(earlier.rule.whenAst, context) &&
            evaluate(later.rule.whenAst, context)
          );
        }),
      );
      if (overlaps)
        conflicts.push(`${earlier.chord}: ${earlier.rule.command} / ${later.rule.command}`);
    }
  }
  return conflicts;
}

describe("default keybindings", () => {
  it("bind no chord to two commands that can apply at once on a Mac", () => {
    expect(defaultConflicts(true)).toEqual([]);
  });

  it("bind no chord to two commands that can apply at once on Windows and Linux", () => {
    expect(defaultConflicts(false)).toEqual([]);
  });
});
