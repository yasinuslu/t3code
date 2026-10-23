import {
  type KeybindingRule,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  MAX_KEYBINDINGS_COUNT,
  MAX_WHEN_EXPRESSION_DEPTH,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  PROFILE_WINDOW_KEYBINDING_COMMANDS,
  type GrowKeybindingCommand,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";

type WhenToken =
  | { type: "identifier"; value: string }
  | { type: "not" }
  | { type: "and" }
  | { type: "or" }
  | { type: "lparen" }
  | { type: "rparen" };

/**
 * Grow's keys, one per command: the physical key on the left hand, held with the Grow
 * modifier. That is Alt on Windows and Linux and Control on a Mac, where Option types special
 * characters. Two rules per command, told apart by `isMac`, so the one keybindings file serves
 * a Mac and a PC alike. `growOpen` scopes them to the Grow screen, which also lets them take a
 * Control chord there (Ctrl+S) that means something else elsewhere.
 */
const GROW_KEYS: ReadonlyArray<{
  readonly command: GrowKeybindingCommand;
  readonly key: string;
  /** The Mac chord when it cannot be plain Control+key. */
  readonly mac?: string;
}> = [
  { command: "grow.step.previous", key: "w" },
  { command: "grow.step.next", key: "s" },
  { command: "grow.page.previous", key: "a" },
  { command: "grow.page.next", key: "d" },
  { command: "grow.zone.threads", key: "1" },
  { command: "grow.zone.presentation", key: "2" },
  { command: "grow.zone.live", key: "3" },
  { command: "grow.zone.chat", key: "4" },
  { command: "grow.back", key: "q" },
  { command: "grow.manager", key: "t" },
  // Ctrl+E is the manager everywhere on a Mac (and the emacs end-of-line).
  { command: "grow.main", key: "e", mac: "ctrl+shift+e" },
  { command: "grow.settle", key: "x" },
  { command: "grow.snooze", key: "c" },
  { command: "grow.supersede", key: "shift+x" },
  { command: "grow.undo", key: "z" },
  { command: "grow.reload", key: "r" },
  { command: "grow.search", key: "f" },
  { command: "grow.toggleProjects", key: "g" },
];

const GROW_DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = GROW_KEYS.flatMap(
  ({ command, key, mac }) => [
    { key: `alt+${key}`, command, when: "growOpen && !isMac" },
    { key: mac ?? `ctrl+${key}`, command, when: "growOpen && isMac" },
  ],
);

/**
 * The profile windows (desktop): Alt+Shift+1 ... 9, Control+Shift+1 ... 9 on a Mac. Not plain
 * Alt+digit, which is Grow's places.
 */
const PROFILE_WINDOW_DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> =
  PROFILE_WINDOW_KEYBINDING_COMMANDS.flatMap((command, index) => [
    { key: `alt+shift+${index + 1}`, command, when: "isDesktop && !isMac" },
    { key: `ctrl+shift+${index + 1}`, command, when: "isDesktop && isMac" },
  ]);

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  // The desktop menu's own accelerators. The preview's zoom keeps its chord while a preview
  // has focus, so these step aside for it.
  // The shortcut sheet. Shift is accepted too, so Ctrl+? opens it, and so does a layout that
  // types / or ? with Shift (Turkish: Shift+7 and Shift+the key right of 0).
  { key: "mod+/", command: "shortcuts.toggle" },
  { key: "mod+shift+/", command: "shortcuts.toggle" },
  { key: "mod+shift+?", command: "shortcuts.toggle" },
  { key: "mod+,", command: "settings.open", when: "isDesktop" },
  { key: "mod+=", command: "zoom.in", when: "isDesktop && !previewFocus" },
  { key: "mod++", command: "zoom.in", when: "isDesktop && !previewFocus" },
  { key: "mod+-", command: "zoom.out", when: "isDesktop && !previewFocus" },
  { key: "mod+0", command: "zoom.reset", when: "isDesktop && !previewFocus" },
  { key: "mod+b", command: "sidebar.toggle" },
  { key: "mod+[", command: "navigation.back", when: "!terminalFocus" },
  { key: "mod+]", command: "navigation.forward", when: "!terminalFocus" },
  { key: "mod+j", command: "terminal.toggle" },
  { key: "mod+alt+\\", command: "rightPanel.toggle" },
  // Right-panel surface chords, app-global so they reach a surface from
  // anywhere rather than only from the launcher's bare letters. `ctrl` rather
  // than `mod` on purpose: these are the same physical chord on every platform.
  // They sit ahead of the `mod`-based defaults below so `preview.toggle` and
  // `diff.toggle` keep advertising their original shortcut in the UI, since the
  // last matching rule is the one a command reports.
  { key: "ctrl+alt+b", command: "preview.toggle" },
  { key: "ctrl+alt+t", command: "rightPanel.toggleTerminal" },
  { key: "ctrl+alt+f", command: "rightPanel.toggleFiles" },
  { key: "ctrl+alt+d", command: "diff.toggle" },
  { key: "ctrl+alt+p", command: "rightPanel.togglePullRequest" },
  // Orchestrator V2 has no Agents surface; subagents live in the thread details panel.
  { key: "ctrl+alt+a", command: "threadPanel.toggle" },
  { key: "mod+d", command: "terminal.split", when: "terminalFocus" },
  { key: "mod+shift+d", command: "terminal.splitVertical", when: "terminalFocus" },
  { key: "mod+n", command: "terminal.new", when: "terminalFocus" },
  { key: "mod+w", command: "terminal.close", when: "terminalFocus" },
  { key: "mod+w", command: "rightPanel.close", when: "!terminalFocus" },
  { key: "mod+d", command: "diff.toggle", when: "!terminalFocus" },
  { key: "mod+shift+j", command: "preview.toggle" },
  { key: "mod+r", command: "preview.refresh", when: "previewFocus" },
  { key: "mod+l", command: "preview.focusUrl", when: "previewFocus" },
  { key: "mod+=", command: "preview.zoomIn", when: "previewFocus" },
  { key: "mod++", command: "preview.zoomIn", when: "previewFocus" },
  { key: "mod+-", command: "preview.zoomOut", when: "previewFocus" },
  { key: "mod+0", command: "preview.resetZoom", when: "previewFocus" },
  { key: "mod+k", command: "commandPalette.toggle", when: "!terminalFocus" },
  { key: "mod+p", command: "filePicker.toggle", when: "!terminalFocus" },
  { key: "mod+shift+f", command: "projectSearch.toggle", when: "!terminalFocus" },
  { key: "mod+u", command: "usage.open", when: "!terminalFocus" },
  // Shows or hides the manager over any screen: Ctrl+Option+Space, three
  // neighbouring keys for the left hand alone. Free on macOS (the input-source
  // chords use Ctrl+Space), GNOME, Windows, terminals and Zed, so the desktop
  // app also takes it system-wide.
  { key: "ctrl+alt+space", command: "manager.toggle" },
  // The same overlay on Ctrl+E, the one the UI advertises. `ctrl` rather than `mod`: it is
  // the Control key on a Mac too, one key from Grow's bare T. It also works inside the
  // composer and other inputs, where it replaces macOS's end-of-line. Not in a terminal,
  // where Ctrl+E is end-of-line in every shell, and never system-wide (see ModeSwitch).
  { key: "ctrl+e", command: "manager.toggle", when: "!terminalFocus" },
  // Steps the code profile in view (yu, sn, ...) and its manager with it; Shift steps
  // back. One light modifier and a letter under the left hand (Grow's bare V does the
  // same). Never Q or W, which close things; Alt+R is Grow's reload. The physical key
  // counts, so what Option types on a Mac layout does not get in the way.
  { key: "alt+v", command: "profile.next", when: "!terminalFocus" },
  { key: "alt+shift+v", command: "profile.previous", when: "!terminalFocus" },
  // On a Mac the profile keys follow Grow's: Control, not Option.
  { key: "ctrl+v", command: "profile.next", when: "!terminalFocus && !editableFocus && isMac" },
  {
    key: "ctrl+shift+v",
    command: "profile.previous",
    when: "!terminalFocus && !editableFocus && isMac",
  },
  // Keyboard-only movement between the panes on screen, vim-style. `ctrl` rather than `mod`
  // so it is the Control key on a Mac too. They work from inside inputs, the composer and
  // a terminal alike, so focus never gets stuck in one pane. Ctrl+H is Backspace and Ctrl+L
  // clears a terminal, which these override inside T3 only; Ctrl+L stays "focus the URL" in
  // the browser panel, which is the right-most pane and has nothing to move to.
  // On a Mac Ctrl+S is Grow's "next thread" and Cmd+B already hides the sidebar, so the sidebar
  // is Ctrl+B there. On Windows and Linux Ctrl+B is that hide chord and Grow holds Alt.
  { key: "ctrl+s", command: "pane.sidebar", when: "!isMac" },
  { key: "ctrl+b", command: "pane.sidebar", when: "isMac && !terminalFocus && !editableFocus" },
  { key: "ctrl+h", command: "pane.left" },
  { key: "ctrl+l", command: "pane.right", when: "!previewFocus" },
  // Rows of the sidebar once it has focus, vim-style (the arrow keys work as well). Control
  // on a Mac, where Option types special characters.
  { key: "alt+k", command: "pane.rowPrevious", when: "!isMac" },
  { key: "alt+j", command: "pane.rowNext", when: "!isMac" },
  { key: "ctrl+k", command: "pane.rowPrevious", when: "isMac && !editableFocus" },
  { key: "ctrl+j", command: "pane.rowNext", when: "isMac && !editableFocus" },
  ...GROW_DEFAULT_KEYBINDINGS,
  ...PROFILE_WINDOW_DEFAULT_KEYBINDINGS,
  // The two screens. `ctrl` rather than `mod`, like the panel chords above, so the
  // chord is the same physical keys everywhere; 0 switches between Grow and T3.
  { key: "ctrl+alt+1", command: "mode.grow" },
  { key: "ctrl+alt+3", command: "mode.normal" },
  { key: "ctrl+alt+0", command: "mode.cycle" },
  // Not Ctrl+Alt+A on Windows and Linux, which is the thread panel.
  { key: "mod+alt+a", command: "theme.select", when: "!terminalFocus && isMac" },
  { key: "ctrl+alt+y", command: "theme.select", when: "!terminalFocus && !isMac" },
  { key: "mod+alt+shift+a", command: "appearance.cycle", when: "!terminalFocus" },
  { key: "mod+alt+shift+t", command: "themeEditor.toggle" },
  { key: "mod+alt+s", command: "composer.stash", when: "!terminalFocus" },
  { key: "mod+shift+enter", command: "thread.steerQueuedMessage", when: "!terminalFocus" },
  { key: "alt+arrowup", command: "thread.editQueuedMessage", when: "composerFocus" },
  { key: "mod+enter", command: "composer.sendAlternate", when: "composerFocus && turnRunning" },
  {
    key: "mod+enter",
    command: "composer.sendBackground",
    when: "composerFocus && draftThreadRoute",
  },
  {
    key: "mod+alt+enter",
    command: "composer.sendBackground",
    when: "composerFocus && draftThreadRoute",
  },
  {
    key: "mod+alt+enter",
    command: "composer.sendAndNewThread",
    when: "composerFocus && !draftThreadRoute",
  },
  { key: "mod+n", command: "chat.new", when: "!terminalFocus" },
  { key: "mod+shift+o", command: "chat.new", when: "!terminalFocus" },
  { key: "mod+shift+n", command: "chat.newLocal", when: "!terminalFocus" },
  { key: "mod+alt+n", command: "chat.newWithoutProject", when: "!terminalFocus" },
  { key: "mod+shift+m", command: "modelPicker.toggle", when: "!terminalFocus" },
  { key: "mod+shift+h", command: "composer.host", when: "!terminalFocus" },
  { key: "mod+shift+e", command: "composer.effort", when: "!terminalFocus" },
  { key: "mod+shift+a", command: "composer.mode", when: "!terminalFocus" },
  { key: "mod+shift+x", command: "composer.workspace", when: "!terminalFocus" },
  { key: "mod+shift+g", command: "composer.branch", when: "!terminalFocus" },
  { key: "mod+shift+l", command: "composer.previousWorktree", when: "!terminalFocus" },
  { key: "mod+shift+k", command: "pullRequest.copyNumber", when: "!terminalFocus" },
  { key: "mod+shift+arrowup", command: "modelPicker.previousProvider", when: "modelPickerOpen" },
  { key: "mod+shift+arrowdown", command: "modelPicker.nextProvider", when: "modelPickerOpen" },
  { key: "mod+o", command: "editor.openFavorite" },
  { key: "mod+shift+[", command: "thread.previous" },
  { key: "mod+shift+]", command: "thread.next" },
  { key: "mod+shift+c", command: "thread.copyReference", when: "!terminalFocus" },
  { key: "mod+shift+s", command: "thread.settle", when: "!terminalFocus" },
  { key: "mod+shift+p", command: "thread.pin", when: "!terminalFocus" },
  { key: "mod+z", command: "thread.undo", when: "!terminalFocus && !editableFocus" },
  ...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
    key: `mod+${index + 1}`,
    command,
    when: "isDesktop",
  })),
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
    key: `mod+${index + 1}`,
    command,
    when: "modelPickerOpen && isDesktop",
  })),
  { key: "alt+c", command: "usage.cost", when: "usagePageOpen" },
  { key: "alt+t", command: "usage.tokens", when: "usagePageOpen" },
  { key: "alt+l", command: "usage.limits", when: "usagePageOpen" },
  { key: "mod+shift+1", command: "usage.period.day", when: "usagePageOpen" },
  { key: "mod+shift+2", command: "usage.period.week", when: "usagePageOpen" },
  { key: "mod+shift+3", command: "usage.period.month", when: "usagePageOpen" },
  { key: "mod+shift+4", command: "usage.period.quarter", when: "usagePageOpen" },
];

function normalizeKeyToken(token: string): string {
  if (token === "space") return " ";
  if (token === "esc") return "escape";
  return token;
}

export function parseKeybindingShortcut(value: string): KeybindingShortcut | null {
  const rawTokens = value
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());
  const tokens = [...rawTokens];
  let trailingEmptyCount = 0;
  while (tokens[tokens.length - 1] === "") {
    trailingEmptyCount += 1;
    tokens.pop();
  }
  if (trailingEmptyCount > 0) {
    tokens.push("+");
  }
  if (tokens.some((token) => token.length === 0)) {
    return null;
  }
  if (tokens.length === 0) return null;

  let key: string | null = null;
  let metaKey = false;
  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;
  let modKey = false;

  for (const token of tokens) {
    switch (token) {
      case "cmd":
      case "meta":
        metaKey = true;
        break;
      case "ctrl":
      case "control":
        ctrlKey = true;
        break;
      case "shift":
        shiftKey = true;
        break;
      case "alt":
      case "option":
        altKey = true;
        break;
      case "mod":
        modKey = true;
        break;
      default: {
        if (key !== null) return null;
        key = normalizeKeyToken(token);
      }
    }
  }

  if (key === null) return null;
  return {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    modKey,
  };
}

function tokenizeWhenExpression(expression: string): WhenToken[] | null {
  const tokens: WhenToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const current = expression[index];
    if (!current) break;

    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (expression.startsWith("&&", index)) {
      tokens.push({ type: "and" });
      index += 2;
      continue;
    }
    if (expression.startsWith("||", index)) {
      tokens.push({ type: "or" });
      index += 2;
      continue;
    }
    if (current === "!") {
      tokens.push({ type: "not" });
      index += 1;
      continue;
    }
    if (current === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (current === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index));
    if (!identifier) {
      return null;
    }
    tokens.push({ type: "identifier", value: identifier[0] });
    index += identifier[0].length;
  }

  return tokens;
}

export function parseKeybindingWhenExpression(expression: string): KeybindingWhenNode | null {
  const tokens = tokenizeWhenExpression(expression);
  if (!tokens || tokens.length === 0) return null;
  let index = 0;

  const parsePrimary = (depth: number): KeybindingWhenNode | null => {
    if (depth > MAX_WHEN_EXPRESSION_DEPTH) {
      return null;
    }
    const token = tokens[index];
    if (!token) return null;

    if (token.type === "identifier") {
      index += 1;
      return { type: "identifier", name: token.value };
    }

    if (token.type === "lparen") {
      index += 1;
      const expressionNode = parseOr(depth + 1);
      const closeToken = tokens[index];
      if (!expressionNode || !closeToken || closeToken.type !== "rparen") {
        return null;
      }
      index += 1;
      return expressionNode;
    }

    return null;
  };

  const parseUnary = (depth: number): KeybindingWhenNode | null => {
    let notCount = 0;
    while (tokens[index]?.type === "not") {
      index += 1;
      notCount += 1;
      if (notCount > MAX_WHEN_EXPRESSION_DEPTH) {
        return null;
      }
    }

    let node = parsePrimary(depth);
    if (!node) return null;

    while (notCount > 0) {
      node = { type: "not", node };
      notCount -= 1;
    }

    return node;
  };

  const parseAnd = (depth: number): KeybindingWhenNode | null => {
    let left = parseUnary(depth);
    if (!left) return null;

    while (tokens[index]?.type === "and") {
      index += 1;
      const right = parseUnary(depth);
      if (!right) return null;
      left = { type: "and", left, right };
    }

    return left;
  };

  const parseOr = (depth: number): KeybindingWhenNode | null => {
    let left = parseAnd(depth);
    if (!left) return null;

    while (tokens[index]?.type === "or") {
      index += 1;
      const right = parseAnd(depth);
      if (!right) return null;
      left = { type: "or", left, right };
    }

    return left;
  };

  const ast = parseOr(0);
  if (!ast || index !== tokens.length) return null;
  return ast;
}

export function compileResolvedKeybindingRule(rule: KeybindingRule): ResolvedKeybindingRule | null {
  const shortcut = parseKeybindingShortcut(rule.key);
  if (!shortcut) return null;

  if (rule.when !== undefined) {
    const whenAst = parseKeybindingWhenExpression(rule.when);
    if (!whenAst) return null;
    return {
      command: rule.command,
      shortcut,
      whenAst,
    };
  }

  return {
    command: rule.command,
    shortcut,
  };
}

export function compileResolvedKeybindingsConfig(
  config: ReadonlyArray<KeybindingRule>,
): ResolvedKeybindingsConfig {
  const compiled: ResolvedKeybindingRule[] = [];
  for (const rule of config) {
    const result = compileResolvedKeybindingRule(rule);
    if (result) {
      compiled.push(result);
    }
  }
  return compiled.slice(-MAX_KEYBINDINGS_COUNT);
}

export const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

export function mergeWithDefaultKeybindings(
  custom: ResolvedKeybindingsConfig,
): ResolvedKeybindingsConfig {
  if (custom.length === 0) {
    return [...DEFAULT_RESOLVED_KEYBINDINGS];
  }

  const overriddenCommands = new Set(custom.map((binding) => binding.command));
  const retainedDefaults = DEFAULT_RESOLVED_KEYBINDINGS.filter(
    (binding) => !overriddenCommands.has(binding.command),
  );
  const merged = [...retainedDefaults, ...custom];

  if (merged.length <= MAX_KEYBINDINGS_COUNT) {
    return merged;
  }

  return merged.slice(-MAX_KEYBINDINGS_COUNT);
}

/**
 * Control+letter chords a macOS text field reads as editing (emacs: A/E line start and end,
 * B/F back and forward, D delete, H backspace, K kill, N/P lines, O open line, T transpose,
 * Y yank). Grow holds its keys with Control on a Mac, so while the caret is in a text field
 * these stay with the text, and a page below the app keeps them too.
 */
const MAC_TEXT_EDITING_LETTERS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "d",
  "e",
  "f",
  "h",
  "k",
  "n",
  "o",
  "p",
  "t",
  "y",
]);

export function isMacTextEditingChord(chord: {
  readonly key: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}): boolean {
  return (
    chord.control &&
    !chord.alt &&
    !chord.meta &&
    !chord.shift &&
    MAC_TEXT_EDITING_LETTERS.has(chord.key.toLowerCase())
  );
}
