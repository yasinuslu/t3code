import type { GrowReturn } from "./returns.logic";

export type GrowKeyAction =
  | { readonly type: "step"; readonly direction: 1 | -1 }
  | { readonly type: "undo" }
  | { readonly type: "search" }
  | { readonly type: "ship" }
  | { readonly type: "done" }
  | { readonly type: "whatIf" }
  | { readonly type: "settle" }
  | { readonly type: "askProof" }
  | { readonly type: "openThread" }
  | { readonly type: "closeThread" }
  | { readonly type: "toggleProjects" }
  | { readonly type: "play" }
  | { readonly type: "image"; readonly direction: 1 | -1 }
  | { readonly type: "scrollStory"; readonly direction: 1 | -1 }
  | { readonly type: "manager" }
  | { readonly type: "profile"; readonly direction: 1 | -1 };

export interface GrowKeyState {
  /** A conversation is showing in place of the deck. */
  readonly conversationOpen: boolean;
  /** The conversation already shows beside the item (wide screens), so `c` has nothing to open. */
  readonly conversationShown?: boolean;
  /** The manager's chat is showing in place of the deck. */
  readonly managerOpen?: boolean;
  /** Focus is inside a chat, where the arrows and Page keys scroll that conversation. */
  readonly inChat?: boolean;
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
 *   C the conversation (narrow)      V the live preview
 *   B / Shift+B next / previous screenshot (the arrows too)   PgDn / PgUp scroll the story
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
  if (!state.inChat) {
    if (key === "b" || key === "arrowright")
      return { type: "image", direction: event.key === "B" ? -1 : 1 };
    if (key === "arrowleft") return { type: "image", direction: -1 };
    if (key === "pagedown") return { type: "scrollStory", direction: 1 };
    if (key === "pageup") return { type: "scrollStory", direction: -1 };
  }
  const open = item.kind === "return" || item.kind === "urgent";
  if (key === "s" && item.kind === "return" && item.shippable) return { type: "ship" };
  if (key === "d" && item.kind === "return") return { type: "done" };
  if (key === "w" && open) return { type: "whatIf" };
  if (key === "x" && open) return { type: "settle" };
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

/**
 * Grow's keys as the shortcut sheet lists them, grouped as it shows them. `grow.keys.test.ts`
 * feeds every key here to `growKeyAction` and requires the action named, so a key that is
 * rebound or removed above fails there until this list follows: the sheet cannot drift.
 * `Shift+R` stands for the shifted letter.
 */
export interface GrowKeyHelp {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
  readonly action: GrowKeyAction["type"];
  /** Only where the conversation is not already beside the proof; the sheet hides it there. */
  readonly narrowOnly?: true;
}

export const GROW_KEY_HELP: ReadonlyArray<{
  readonly group: string;
  readonly entries: ReadonlyArray<GrowKeyHelp>;
}> = [
  {
    group: "Move",
    entries: [
      { keys: ["Q", "E"], label: "Previous / next item", action: "step" },
      { keys: ["F"], label: "Search", action: "search" },
      { keys: ["G"], label: "Expand every project", action: "toggleProjects" },
    ],
  },
  {
    group: "Act on the card",
    entries: [
      { keys: ["W"], label: "Reply, or change it", action: "whatIf" },
      { keys: ["S"], label: "Ship", action: "ship" },
      { keys: ["D"], label: "Done", action: "done" },
      { keys: ["X"], label: "Settle", action: "settle" },
      { keys: ["A"], label: "Ask for proof again", action: "askProof" },
      { keys: ["Z"], label: "Undo", action: "undo" },
    ],
  },
  {
    group: "View",
    entries: [
      {
        keys: ["C"],
        label: "Whole conversation (again to close)",
        action: "openThread",
        narrowOnly: true,
      },
      { keys: ["V"], label: "Live preview", action: "play" },
      { keys: ["B", "Shift+B"], label: "Next / previous screenshot", action: "image" },
      { keys: ["PgDn", "PgUp"], label: "Scroll the story", action: "scrollStory" },
      { keys: ["T"], label: "Manager", action: "manager" },
    ],
  },
  {
    group: "Profile",
    entries: [{ keys: ["R", "Shift+R"], label: "Next / previous profile", action: "profile" }],
  },
];
