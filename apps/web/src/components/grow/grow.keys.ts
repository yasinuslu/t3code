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
  | { readonly type: "play" };

export interface GrowKeyState {
  /** A conversation is showing in place of the deck. */
  readonly conversationOpen: boolean;
  readonly item: GrowReturn | null;
}

/**
 * What a key does on the Grow screen. Pure, so each key has a test; the screen
 * only supplies whether a conversation is showing and which item is current.
 * While a conversation shows, the deck's keys stay off and `o` goes back.
 */
export function growKeyAction(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing">,
  state: GrowKeyState,
): GrowKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null;
  if (state.conversationOpen) return event.key === "o" ? { type: "closeThread" } : null;
  switch (event.key) {
    case "j":
    case "ArrowDown":
      return { type: "step", direction: 1 };
    case "k":
    case "ArrowUp":
      return { type: "step", direction: -1 };
    case "u":
      return { type: "undo" };
    case "/":
      return { type: "search" };
  }
  const { item } = state;
  if (item === null) return null;
  const open = item.kind === "return" || item.kind === "urgent";
  if (event.key === "s" && item.kind === "return" && item.shippable) return { type: "ship" };
  if (event.key === "d" && item.kind === "return") return { type: "done" };
  if ((event.key === "w" || event.key === "r") && open) return { type: "whatIf" };
  if (event.key === "x" && open) return { type: "letGo" };
  if (event.key === "a" && open && !item.thread.statusProof) return { type: "askProof" };
  if (event.key === "o") return { type: "openThread" };
  if ((event.key === "p" || event.key === "Enter") && item.playUrl !== null) {
    return { type: "play" };
  }
  return null;
}
