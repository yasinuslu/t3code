# Keybindings

Every shortcut can be changed. Open **Settings → Keybindings** on web and desktop: search the
list, click a key to record a new one, and a warning shows when it clashes with another command.
Reset one binding, or use **Reset all keybindings** to return to the defaults. The page also lists
the command IDs and defaults available in your version, and your changes are saved to
the [configuration file](#edit-the-configuration-file), which you can edit by hand too.

## Composer controls

In **Settings → General → Send shortcut**, choose whether Enter sends, requires
`mod+Enter` for multiline prompts, or always requires `mod+Enter`. `Shift+Enter`
inserts a new line. This applies to the web and desktop composer at desktop widths.

**Follow-up behavior** chooses Queue or Steer while the agent runs. Use
`mod+Enter` to do the opposite for one message, even when the send shortcut
requires a modifier. `mod+Alt+Enter` sends, keeps that thread running in the
background, and opens a fresh new-thread composer. In a new thread, `mod+Enter`
does the same. Change these shortcuts in **Settings → Keybindings** under
**Composer: Opposite Queue or Steer Action**, **Composer: Start in Background**,
or **Composer: Send and Start New Thread**. These bindings take priority over the
send shortcut. Click the send button to use the configured follow-up behavior.

When an active turn has queued messages, `mod+Shift+Enter` sends the first as a
steer. Change it under **Queue: Send First Queued Message as Steer** in Keybindings.

Use `mod+shift+m` to choose a model and `mod+shift+h` to choose a host.
To step a new thread to the next machine instead of opening the menu, bind
**Composer: Cycle Host** in Keybindings. It has no default shortcut.
Use `mod+shift+e` for effort, `mod+shift+a` for access mode, `mod+shift+x` for the
workspace, and `mod+shift+g` for the Git branch. The workspace menu includes the
current checkout, a new worktree, and the previous worktree when available.
Use `mod+shift+l` to reuse the previous worktree directly.

In the model picker, press Left in an empty search field or Shift+Tab to reach
the provider list. Use Up/Down to move and Enter to choose. Right returns to
model search. `mod+shift+up` and `mod+shift+down` switch providers directly and clear the
search. These provider shortcuts can also be changed in Settings.

These shortcuts run inside the focused web or desktop client. `mod` uses Command
on macOS and Ctrl on Windows and Linux, including GNOME, KDE Plasma, Niri, and
Hyprland. If a custom desktop shortcut takes the same keys, choose another binding
in Settings.

## Manager

`ctrl+e` (the Control key on a Mac too) shows [the manager](./manager.md) from any screen,
composer and text boxes included, and `ctrl+alt+space` (Ctrl+Option+Space on a Mac) from any screen,
terminal included, and pressed again goes back to where you were. In the desktop app it works system-wide: from another app it brings
T3 Code forward with the manager open. Rebind it under **Manager: Toggle**; the desktop app takes
the new chord system-wide too.

## Shortcut sheet

Press `mod+/` or `mod+?` (from a text box too) or click the keyboard button beside the notifications
bell to see the shortcuts that work where you are: Grow's keys first in Grow, the app-wide ones
first elsewhere. Layouts that type `/` or `?` with Shift, such as Turkish, work as typed. The sheet
reads your current keybindings, so remapped keys show as you set them. The same chord or `Esc`
closes it.

## Moving between panes

`ctrl+s` (`ctrl+b` on a Mac outside text boxes and the terminal, where `ctrl+s` is Grow's next thread and `cmd+b` hides the sidebar)
focuses the sidebar (Grow's list in Grow, the thread list elsewhere), on the item
you are on, so `j`/`k` or the arrows move at once. `ctrl+h` and `ctrl+l` move focus one pane to the left
or right in screen order (sidebar, chat, right panel), from inside a text box too; each pane
remembers what you had focused in it, and the focused pane gets a thin ring. Focus never enters a
browser or preview frame on its own: leave it with `ctrl+h`. These chords override
the terminal's Ctrl+L (clear) and Ctrl+H (backspace) inside T3 Code, and `ctrl+e` overrides
end-of-line on a Mac in text boxes (not in the terminal). `ctrl+s` replaced Stash for the
composer, now `mod+alt+s`. Rebind them under **Pane: Sidebar / Left / Right**.

## Grow keys

On the Grow screen the left hand sits on WASD, with Alt on Windows and Linux and Control on a Mac
(where Option types special characters): `alt+w` / `alt+s` (Mac: `ctrl+w` / `ctrl+s`) step to the
previous and next thread, `a` / `d` turn pages, `1`-`4` jump to the threads, presentation, live app
and chat, `q` goes back, `e` ships or clears the card (Mac: `ctrl+shift+e`, since `ctrl+e` is the
manager), `x` settles, `c` snoozes (or wakes a snoozed thread), `z` undoes, `r` reloads, `f` finds, `g` opens every project and `t` talks to the
manager. On a Mac, `ctrl+a`, `ctrl+d`, `ctrl+f` and `ctrl+t` stay with the text while the caret is in a
text box.
Each one is a `grow.*` command, scoped by the `growOpen` condition, with one rule for `!isMac` and
one for `isMac`. Rebind any of them in Settings and the cheat sheet follows.

## Profiles

`alt+v` switches the code profile in view, and its manager with it, to the next one; `alt+shift+v`
goes back (`ctrl+v` and `ctrl+shift+v` on a Mac). In the desktop app, `alt+shift+1` to
`alt+shift+9` (`ctrl+shift+1` to `9` on a Mac) open or focus a profile window. Rebind the chords in
**Settings → Keybindings**.

## Copy pull request references

With a PR open in the right panel or on the Pull Requests page, use `mod+shift+c`
to copy its URL and `mod+shift+k` to copy its number with a `#` prefix.
Both shortcuts can be changed in Settings. Search for “Copy Link or Thread ID”
or “Copy Number”. They copy the selected PR and leave terminal input alone.

## iPad

With a hardware keyboard, use `Cmd+1` through `Cmd+9` to open the first nine
displayed threads. The shortcuts follow the current list filters and order.
`Cmd+K` opens the command palette to search commands, projects, and threads.
Use the arrow keys and Return to choose a result, or `Cmd+1` through `Cmd+9` to
choose directly. Escape or `Cmd+K` closes the palette. Start a search with `>`
to show only actions.

In a new thread, `Cmd+Shift+H` moves the draft to the next machine.

In the composer, Return sends and `Shift+Return` inserts a new line. `Cmd+Return`
also sends. To make Return insert a new line instead, change the Return key
behavior in Settings → Keyboard.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.t3/userdata/keybindings.json` by default. You can edit this file directly.
It is a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

T3 Code creates the file with its defaults and adds new defaults on later startups.
New defaults do not replace commands you customized. If a new default overlaps one
of your shortcuts, [rule order](#precedence) decides which runs.
Invalid rules are ignored; if the file cannot be parsed, T3 Code uses defaults.

## Rule shape

Each rule requires a `key` shortcut and a `command` ID. An optional `when`
expression restricts when it runs.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, `growOpen`, `isMac`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`, `composerDraft`,
`turnRunning`, `editableFocus`, `isWeb`, and `isDesktop`.
`growOpen` is true on the Grow screen and `isMac` on macOS.
`editableFocus` is true while a text field, the composer, or another editor has
the keyboard. `isWeb` is true in a browser tab. `isDesktop` is true in the
desktop app. Unknown keys evaluate to `false`.

`mod+1` through `mod+9` jump to the first nine threads, and to models while the
model picker is open. Those defaults use `isDesktop` so they do not steal the
browser's tab-switch shortcuts. Remove that condition in Settings if you want
the same jumps in a browser.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

```json
{ "key": "mod+j", "command": "terminal.toggle", "when": "terminalOpen && !terminalFocus" }
```

## Precedence

The last rule whose key and condition both match wins, even if it belongs to a
different command. Put a more specific rule after a general one when they share
a shortcut.

## Commands with special behavior

`thread.stop` interrupts the running turn in the focused thread. It has no default
shortcut; assign one in **Settings → Keybindings**.

`thread.undo` (`mod+z` by default) reverses the actions shown in the notice at the
bottom of the sidebar, such as unpin, settle, snooze, archive, or discarding a
draft. Consecutive
actions of the same kind undo together. The notice remains available for five
seconds after the latest action. The default shortcut skips text fields and
terminals so native undo keeps working there.

`navigation.back` (`mod+[` by default) and `navigation.forward` (`mod+]`) move
through the pages you have visited, like a browser's back and forward buttons.

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread). `chat.newWithoutProject`
(`mod+alt+n`) starts a thread [without a project](./thread-sidebar.md#start-without-a-project).

## Right panel surfaces

Each right-panel surface has a `Ctrl+Alt` chord that works anywhere in the app,
including the composer. Press it to open the surface and again to hide the panel.
Hiding keeps browser tabs and running shells.

| Surface      | Shortcut     | Command                        |
| ------------ | ------------ | ------------------------------ |
| Browser      | `Ctrl+Alt+B` | `preview.toggle`               |
| Terminal     | `Ctrl+Alt+T` | `rightPanel.toggleTerminal`    |
| Files        | `Ctrl+Alt+F` | `rightPanel.toggleFiles`       |
| Diff         | `Ctrl+Alt+D` | `diff.toggle`                  |
| Pull request | `Ctrl+Alt+P` | `rightPanel.togglePullRequest` |
| Thread panel | `Ctrl+Alt+A` | `threadPanel.toggle`           |

These are literal `Ctrl+Alt` on every platform, not `mod`. `rightPanel.toggle`
now defaults to `mod+alt+\`; an untouched `mod+alt+b` default moves there on the
next start. Some Linux desktops take `Ctrl+Alt+T` for themselves; rebind
`rightPanel.toggleTerminal` if so.

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.
