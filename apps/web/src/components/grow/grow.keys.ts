import type { GrowReturn } from "./returns.logic";

export type GrowKeyAction =
  | { readonly type: "step"; readonly direction: 1 | -1 }
  | { readonly type: "undo" }
  | { readonly type: "search" }
  | { readonly type: "ship" }
  | { readonly type: "done" }
  | { readonly type: "whatIf" }
  | { readonly type: "letGo" }
  | { readonly type: "askProof" }
  | { readonly type: "openThread" }
  | { readonly type: "closeThread" }
  | { readonly type: "toggleProjects" }
  | { readonly type: "play" }
  | { readonly type: "manager" }
  | { readonly type: "profile"; readonly direction: 1 | -1 };

export interface GrowKeyState {
  /** A conversation is showing in place of the deck. */
  readonly conversationOpen: boolean;
  /** The conversation already shows beside the item (wide screens), so `o` has nothing to open. */
  readonly conversationShown?: boolean;
  /** The manager's chat is showing in place of the deck. */
  readonly managerOpen?: boolean;
  readonly item: GrowReturn | null;
}

/**
 * What a key does on the Grow screen. Pure, so each key has a test; the screen
 * only supplies whether a conversation is showing and which item is current.
 *
 * Every key sits under the left hand, so the right one stays on the mouse:
 *
 *   Q / E  previous / next item      S ship      D done     W what if (or reply)
 *   X settle (off the list)          Z undo      A ask for proof
 *   C the conversation               V the live preview
 *   F find                           G expand every project
 *   T talk to the manager            R next profile (Shift+R: previous)
 *
 * The arrows and J / K step as well, for hands that already know them. While a
 * conversation shows, the deck's keys stay off and `c` goes back. The manager is
 * pinned above the list and never one of the items Q and E step through, which
 * take the screen back to the deck.
 */
export function growKeyAction(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing">,
  state: GrowKeyState,
): GrowKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null;
  const key = event.key.toLowerCase();
  if (key === "r") return { type: "profile", direction: event.key === "R" ? -1 : 1 };
  if (key === "t") return { type: "manager" };
  if (state.managerOpen) return stepAction(key);
  if (state.conversationOpen) return key === "c" ? { type: "closeThread" } : null;
  const step = stepAction(key);
  if (step !== null) return step;
  switch (key) {
    case "z":
      return { type: "undo" };
    case "f":
    case "/":
      return { type: "search" };
    case "g":
      return { type: "toggleProjects" };
  }
  const { item } = state;
  if (item === null) return null;
  const open = item.kind === "return" || item.kind === "urgent";
  if (key === "s" && item.kind === "return" && item.shippable) return { type: "ship" };
  if (key === "d" && item.kind === "return") return { type: "done" };
  if (key === "w" && open) return { type: "whatIf" };
  if (key === "x" && open) return { type: "letGo" };
  if (key === "a" && open && !item.thread.statusProof) return { type: "askProof" };
  if (key === "c" && !state.conversationShown) return { type: "openThread" };
  if ((key === "v" || key === "enter") && item.playUrl !== null) return { type: "play" };
  return null;
}

function stepAction(key: string): GrowKeyAction | null {
  if (key === "e" || key === "j" || key === "arrowdown") return { type: "step", direction: 1 };
  if (key === "q" || key === "k" || key === "arrowup") return { type: "step", direction: -1 };
  return null;
}
