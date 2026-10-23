import {
  type GrowKeybindingCommand,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { isMacTextEditingChord } from "@t3tools/shared/keybindings";

import {
  resolveShortcutCommand,
  shortcutKeyFromEvent,
  type ShortcutEventLike,
} from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
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
  | { readonly type: "manager" };

export interface GrowKeyState {
  /** Focus is in a text field (the composer, search), which owns the plain keys. */
  readonly typing: boolean;
  /** Focus is in the live app, which owns the plain keys. */
  readonly inLive: boolean;
  /** The manager's chat is showing in place of the item. */
  readonly managerOpen: boolean;
  readonly item: GrowReturn | null;
}

const ACTIONS: Readonly<Record<GrowKeybindingCommand, GrowKeyAction>> = {
  "grow.step.previous": { type: "step", direction: -1 },
  "grow.step.next": { type: "step", direction: 1 },
  "grow.page.previous": { type: "page", direction: -1 },
  "grow.page.next": { type: "page", direction: 1 },
  "grow.zone.threads": { type: "zone", zone: "threads" },
  "grow.zone.presentation": { type: "zone", zone: "presentation" },
  "grow.zone.live": { type: "zone", zone: "live" },
  "grow.zone.chat": { type: "zone", zone: "chat" },
  "grow.back": { type: "back" },
  "grow.manager": { type: "manager" },
  "grow.main": { type: "main" },
  "grow.settle": { type: "settle" },
  "grow.supersede": { type: "supersede" },
  "grow.undo": { type: "undo" },
  "grow.reload": { type: "reload" },
  "grow.search": { type: "search" },
  "grow.toggleProjects": { type: "toggleProjects" },
};

export const isGrowCommand = (command: string | null): command is GrowKeybindingCommand =>
  command !== null && Object.hasOwn(ACTIONS, command);

/**
 * What a key does on the Grow screen. Pure, so each key has a test.
 *
 * Built for a left hand resting on WASD while the right one stays on the mouse, the way an
 * FPS is played. The keys are the `grow.*` keybindings (Settings › Keybindings), held by default
 * with Alt (the thumb) on Windows and Linux and with Control on a Mac, where Option types
 * special characters. Letters and digits are matched by their physical place (`event.code`),
 * so the layout under them does not matter. A key works everywhere, from the composer, from
 * inside the live app and from inline components too.
 *
 *   W / S   previous / next thread (the place you are in stays: live stays live)
 *   A / D   previous / next page of the presentation
 *   1 threads   2 presentation   3 live   4 chat        Q back to where you just were
 *   E the card's main move (ship, or done)   X settle   Shift+X superseded by...   Z undo
 *   R reload the live app   F find   G expand every project   T manager
 *   V / Shift+V next / previous profile (the global `profile.*` keys)
 *
 * On a Mac a Control+letter that a text field reads as editing (A, D, E, F, T, ...) stays with
 * the text while the caret is in one.
 */
export function growKeyAction(
  event: ShortcutEventLike & { readonly isComposing?: boolean },
  state: GrowKeyState,
  keybindings: ResolvedKeybindingsConfig,
  platform: string = navigator.platform,
): GrowKeyAction | null {
  if (event.isComposing) return null;
  if (
    state.typing &&
    isMacPlatform(platform) &&
    isMacTextEditingChord({
      key: event.code?.match(/^Key([A-Z])$/)?.[1] ?? shortcutKeyFromEvent(event),
      control: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    })
  ) {
    return null;
  }
  const command = resolveShortcutCommand(physicalKey(event), keybindings, {
    platform,
    context: { growOpen: true },
  });
  return isGrowCommand(command) ? allowed(ACTIONS[command], state) : null;
}

/**
 * A letter or digit read by its place on the keyboard: the event without the layout's key, so
 * an AZERTY, Dvorak or Turkish F keyboard keeps WASD under the left hand. Other keys (arrows,
 * Enter, F-keys) have no place of their own and are read as typed.
 */
function physicalKey<Event extends ShortcutEventLike>(event: Event): ShortcutEventLike {
  if (!/^(Key[A-Z]|Digit[0-9])$/.test(event.code ?? "")) return event;
  return {
    ...(event.type !== undefined && { type: event.type }),
    ...(event.code !== undefined && { code: event.code }),
    key: "",
    ...(event.repeat !== undefined && { repeat: event.repeat }),
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ...(event.target !== undefined && { target: event.target }),
    ...(event.composedPath && { composedPath: event.composedPath.bind(event) }),
    ...(event.getModifierState && { getModifierState: event.getModifierState.bind(event) }),
  };
}

/** Whether the screen can take the action now, or the keys stay off. */
function allowed(action: GrowKeyAction, state: GrowKeyState): GrowKeyAction | null {
  switch (action.type) {
    case "step":
    case "undo":
    case "back":
    case "manager":
    case "search":
      return action;
    case "zone":
      if (action.zone === "threads") return action;
      break;
  }
  if (action.type === "toggleProjects" || (action.type === "zone" && action.zone === "chat")) {
    return action;
  }
  // The manager is not an item: only the keys above, which take the screen back to one.
  if (state.managerOpen) return null;
  const { item } = state;
  if (item === null) return null;
  const open = item.kind === "return" || item.kind === "urgent";
  switch (action.type) {
    case "page":
      return action;
    case "zone":
      return action.zone === "live" && item.playUrl === null ? null : action;
    case "reload":
      return item.playUrl === null ? null : action;
    case "main":
      return item.kind === "return" ? action : null;
    case "settle":
      return open ? action : null;
    case "supersede":
      return item.kind === "working" ? null : action;
  }
  return null;
}

/** The Grow command a replayed key press stands for, for hosts that must forward it. */
export function growCommandOfKey(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  platform: string = navigator.platform,
): GrowKeybindingCommand | null {
  const command = resolveShortcutCommand(physicalKey(event), keybindings, {
    platform,
    context: { growOpen: true },
  });
  return isGrowCommand(command) ? command : null;
}

/** What each Grow command is called in Settings and the shortcut sheet. */
export const GROW_COMMAND_LABELS: Readonly<Record<GrowKeybindingCommand, string>> = {
  "grow.step.previous": "Previous thread",
  "grow.step.next": "Next thread",
  "grow.page.previous": "Previous page",
  "grow.page.next": "Next page",
  "grow.zone.threads": "Go to threads",
  "grow.zone.presentation": "Go to the presentation",
  "grow.zone.live": "Go to the live app",
  "grow.zone.chat": "Go to the chat",
  "grow.back": "Back to where you were",
  "grow.manager": "Manager",
  "grow.main": "Ship, or done",
  "grow.settle": "Settle",
  "grow.supersede": "Settle, superseded by...",
  "grow.undo": "Undo",
  "grow.reload": "Reload the live app",
  "grow.search": "Find a thread",
  "grow.toggleProjects": "Expand every project",
};

/**
 * Grow's keys as the shortcut sheet lists them, grouped as it shows them. The keys themselves
 * come from the live keybindings, so the sheet shows what a rebound key really is.
 * `grow.keys.test.ts` requires every Grow command to be listed once.
 */
export interface GrowKeyHelp {
  readonly commands: ReadonlyArray<KeybindingCommand>;
  readonly label: string;
}

export const GROW_KEY_HELP: ReadonlyArray<{
  readonly group: string;
  readonly entries: ReadonlyArray<GrowKeyHelp>;
}> = [
  {
    group: "Move",
    entries: [
      {
        commands: ["grow.step.previous", "grow.step.next"],
        label: "Previous / next thread",
      },
      { commands: ["grow.page.previous", "grow.page.next"], label: "Previous / next page" },
      { commands: ["grow.search"], label: GROW_COMMAND_LABELS["grow.search"] },
      { commands: ["grow.toggleProjects"], label: GROW_COMMAND_LABELS["grow.toggleProjects"] },
    ],
  },
  {
    group: "Jump to",
    entries: [
      { commands: ["grow.zone.threads"], label: "Threads" },
      { commands: ["grow.zone.presentation"], label: "Presentation" },
      { commands: ["grow.zone.live"], label: "Live" },
      { commands: ["grow.zone.chat"], label: "Chat" },
      { commands: ["grow.back"], label: GROW_COMMAND_LABELS["grow.back"] },
      { commands: ["grow.manager"], label: GROW_COMMAND_LABELS["grow.manager"] },
    ],
  },
  {
    group: "Act",
    entries: [
      { commands: ["grow.main"], label: GROW_COMMAND_LABELS["grow.main"] },
      { commands: ["grow.settle"], label: GROW_COMMAND_LABELS["grow.settle"] },
      { commands: ["grow.supersede"], label: GROW_COMMAND_LABELS["grow.supersede"] },
      { commands: ["grow.undo"], label: GROW_COMMAND_LABELS["grow.undo"] },
      { commands: ["grow.reload"], label: GROW_COMMAND_LABELS["grow.reload"] },
      {
        commands: ["profile.next", "profile.previous"],
        label: "Next / previous profile",
      },
    ],
  },
];
