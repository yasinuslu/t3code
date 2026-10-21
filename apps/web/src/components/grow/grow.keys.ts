import type { GrowReturn } from "./returns.logic";

/** The places on the Grow screen the number keys jump to, like weapon slots. */
export type GrowZone = "threads" | "presentation" | "live" | "chat";

export type GrowKeyAction =
  | { readonly type: "step"; readonly direction: 1 | -1 }
  | { readonly type: "page"; readonly direction: 1 | -1 }
  | { readonly type: "zone"; readonly zone: GrowZone }
  | { readonly type: "back" }
  | { readonly type: "main" }
  | { readonly type: "settle" }
  | { readonly type: "supersede" }
  | { readonly type: "undo" }
  | { readonly type: "reload" }
  | { readonly type: "search" }
  | { readonly type: "toggleProjects" }
  | { readonly type: "manager" }
  | { readonly type: "profile"; readonly direction: 1 | -1 };

export interface GrowKeyState {
  /** Focus is in a text field (the composer, search), which owns the plain keys. */
  readonly typing: boolean;
  /** Focus is in the live app, which owns the plain keys. */
  readonly inLive: boolean;
  /** The manager's chat is showing in place of the item. */
  readonly managerOpen: boolean;
  readonly item: GrowReturn | null;
}

/**
 * What a key does on the Grow screen. Pure, so each key has a test.
 *
 * Built for a left hand resting on WASD while the right one stays on the mouse, the way an
 * FPS is played. Keys are matched by their physical place (`event.code`), so the layout under
 * them does not matter. A plain key works wherever nothing is being typed; held with Alt (the
 * thumb) the same key works everywhere, from the composer and from inside the live app too.
 *
 *   W / S   previous / next thread (the place you are in stays: live stays live)
 *   A / D   previous / next page of the presentation
 *   1 threads   2 presentation   3 live   4 chat        Q back to where you just were
 *   E the card's main move (ship, or done)   X settle   Shift+X superseded by...   Z undo
 *   R reload the live app   F find   G expand every project   T manager
 *   V / Shift+V next / previous profile
 */
export function growKeyAction(
  event: Pick<
    KeyboardEvent,
    "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "isComposing"
  >,
  state: GrowKeyState,
): GrowKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.isComposing) return null;
  if (!event.altKey && (state.typing || state.inLive)) return null;
  return mapCode(event.code, event.shiftKey, state);
}

function mapCode(code: string, shift: boolean, state: GrowKeyState): GrowKeyAction | null {
  switch (code) {
    case "KeyW":
      return { type: "step", direction: -1 };
    case "KeyS":
      return { type: "step", direction: 1 };
    case "Digit1":
      return { type: "zone", zone: "threads" };
    case "KeyT":
      return { type: "manager" };
    case "KeyV":
      return { type: "profile", direction: shift ? -1 : 1 };
    case "KeyF":
      return { type: "search" };
    case "KeyZ":
      return { type: "undo" };
    case "KeyQ":
      return { type: "back" };
  }
  // The manager is not an item: only the keys above, which take the screen back to one.
  if (state.managerOpen) return null;
  switch (code) {
    case "Digit4":
      return { type: "zone", zone: "chat" };
    case "KeyG":
      return { type: "toggleProjects" };
  }
  const { item } = state;
  if (item === null) return null;
  const open = item.kind === "return" || item.kind === "urgent";
  switch (code) {
    case "KeyA":
      return { type: "page", direction: -1 };
    case "KeyD":
      return { type: "page", direction: 1 };
    case "Digit2":
      return { type: "zone", zone: "presentation" };
    case "Digit3":
      return item.playUrl === null ? null : { type: "zone", zone: "live" };
    case "KeyR":
      return item.playUrl === null ? null : { type: "reload" };
    case "KeyE":
      return item.kind === "return" ? { type: "main" } : null;
    case "KeyX":
      if (shift) return item.kind === "working" ? null : { type: "supersede" };
      return open ? { type: "settle" } : null;
  }
  return null;
}

/** The codes `growKeyAction` reads, for a host that must catch them before a page does. */
export const GROW_KEY_CODES: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyX",
  "KeyZ",
  "KeyR",
  "KeyF",
  "KeyG",
  "KeyT",
  "KeyV",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
]);

/**
 * Grow's keys as the shortcut sheet lists them, grouped as it shows them. `grow.keys.test.ts`
 * feeds every key here to `growKeyAction` and requires the action named, so a key that is
 * rebound or removed above fails there until this list follows: the sheet cannot drift.
 * `Shift+X` stands for the shifted key.
 */
export interface GrowKeyHelp {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
  readonly action: GrowKeyAction["type"];
}

export const GROW_KEY_HELP: ReadonlyArray<{
  readonly group: string;
  readonly entries: ReadonlyArray<GrowKeyHelp>;
}> = [
  {
    group: "Move (every key here also works with Alt, even while typing or playing)",
    entries: [
      { keys: ["W", "S"], label: "Previous / next thread", action: "step" },
      { keys: ["A", "D"], label: "Previous / next page", action: "page" },
      { keys: ["F"], label: "Find a thread", action: "search" },
      { keys: ["G"], label: "Expand every project", action: "toggleProjects" },
    ],
  },
  {
    group: "Jump to",
    entries: [
      { keys: ["1"], label: "Threads", action: "zone" },
      { keys: ["2"], label: "Presentation", action: "zone" },
      { keys: ["3"], label: "Live", action: "zone" },
      { keys: ["4"], label: "Chat", action: "zone" },
      { keys: ["Q"], label: "Back to where you were", action: "back" },
      { keys: ["T"], label: "Manager", action: "manager" },
    ],
  },
  {
    group: "Act",
    entries: [
      { keys: ["E"], label: "Ship, or done", action: "main" },
      { keys: ["X"], label: "Settle", action: "settle" },
      { keys: ["Shift+X"], label: "Settle, superseded by...", action: "supersede" },
      { keys: ["Z"], label: "Undo", action: "undo" },
      { keys: ["R"], label: "Reload the live app", action: "reload" },
      { keys: ["V", "Shift+V"], label: "Next / previous profile", action: "profile" },
    ],
  },
];
