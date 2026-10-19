# The manager

The manager is an ordinary thread that runs your goals: it plans tasks, starts and steers worker
threads, and brings you in only for real decisions. Each code profile has its own manager. It floats
over the app, so you can reach it from wherever you are.

## Showing the manager

Press `ctrl+alt+space` (Ctrl+Option+Space on a Mac, three neighbouring keys for the left hand).
The manager opens over whatever screen you are on, Grow, a thread or settings, with its composer
focused. Press it again, or Esc, to hide it; a draft you left in the composer is still there next
time. Clicking a thread link in its answer takes you to that thread and hides the manager.

In the desktop app the shortcut works system-wide: from another app it brings T3 Code forward with
the manager open. If another app already owns the chord (or on a Linux Wayland session, which has
no global shortcuts), it still works while T3 Code is in front. You can also click the
speech-bubble button next to the Grow and Threads switch at the top left, or choose **Show or hide
the manager** in the command palette. Change the shortcut in
**Settings → Keybindings** under **Manager: Toggle**.

If the machine that runs the manager is offline, the overlay says so instead of showing a stale
chat, and opens the manager by itself once that machine reconnects.

## Screens

The switch at the top left of the window moves between **Grow** (the idea board) and **Threads**
(the thread list and chat). Each keeps its place: the selected card, scroll positions, and the thread you
had open. The app reopens on the screen you left. `ctrl+alt+1` and `ctrl+alt+3` pick Grow and
Threads; `ctrl+alt+0` switches between them. Change them in **Settings → Keybindings** under **Mode**.

The manager has no row in the sidebar's thread list. Agents keep a status card at the top of their thread current with
the `thread_status_update` tool; its screenshots are stored with the thread, so they survive a
deleted worktree.

## One manager per profile

Every code profile with a brain (a `~/code/<profile>/<profile>-brain` repository) gets its own
manager, created in that brain's project the first time you open it. Because it works in the
profile's folder, it runs with that profile's provider settings and account. Its task and thread
tools see only its profile: its goals and tasks, and the threads of that profile's projects. Work
for another profile belongs to that profile's manager.

Switch profiles with the switcher in the manager's header. Picking a
profile shows its manager and makes its space the active space, so Grow and the sidebar follow.
**All** shows every profile's work and keeps the manager you had; managers themselves never see
across profiles. Switching spaces in the sidebar switches the manager too, and the manager opens on
the last profile you picked. A manager opened as a page has the same switcher in its header.

Before you pick one, the manager shown is the default profile's: the profile that a symlink directly
under `~/code` points into, or else the first profile by name. Without any profile brain there is
one manager for everything, in the project you used most recently. Unpin, rename or archive a manager
like any thread; after archiving, the next open starts a new one.

The managers run on the machine you connected to, unless one of your connected machines has
**Settings → General → Host the manager** turned on: then every device opens the managers, their goals
and their tasks on that machine, and its tools reach that machine's threads. Turn it on for a machine
that stays on, so the manager keeps working while a laptop is closed. While that machine is offline,
the manager says so instead of opening one elsewhere.

To run each profile's manager where that profile's work happens, list the profiles in **Settings →
General → Managers hosted here** on each machine (for example `sn` on a laptop, `yu` on a desktop).
A machine that lists profiles runs only those managers. Every device that connects to both
machines opens each manager on the machine that lists it.

When two machines list the same profile, each runs its own manager for it: a separate chat with its
own history, nothing shared or moved between them. The manager's header then shows a machine
switcher next to the profile switcher; pick a machine to open its manager. It remembers your pick per
profile and otherwise starts on the machine you connected to. A machine that is offline is shown
as offline and is not opened, and a dot on a machine means its manager is working or has news.

Tell it what you want done. It breaks goals into tasks, starts worker threads, answers their routine
questions and closes tasks. It reads its rules again after a restart, so nothing depends on its chat
history.

A manager starts every session knowing its role and its profile. To add your own rules, such as
where new work should run or how you like reports, write them in `MANAGER.md` at the root of a
profile's brain. A profile without its own `MANAGER.md` uses the default profile's. The manager gets
the file's current text at the start of each session and from `manager_overview`.

The manager's tools are on the `t3-code` MCP server: `manager_overview` (its rules, its profile's
brain and task file), `list_tasks`, `add_goal`, `update_goal`, `delete_goal`, `add_task`,
`update_task`, `complete_task`, `delete_task`, `list_threads` (its profile's threads with a
one-word status) and `set_thread_space`. The `t3_thread_*`, `t3_pending_request_*` and
`t3_thread_search` tools reach the threads of every project in its profile for a manager, and only
the calling project's threads for any other thread. The manager starts workers with `t3_thread_launch`.

The manager can also work on your other T3 Code servers. Set each one up once on the machine that
hosts the manager: issue a token on the other server with `t3 auth session issue --token-only` (it lasts 30 days
unless you pass a longer `--ttl`), then
pipe it into `t3 peer add --name <name> --url <its http(s) address> --token-stdin`. The command
checks that the server answers before saving the token in the manager machine's secret store; pass
the same `--base-dir` the server uses if it is not the default. `t3 peer list` shows the peers and
`t3 peer remove <name>` forgets one. The manager then lists, reads, starts and messages threads there
with the `t3_peer_*` tools; a peer that is offline is reported as unreachable.

## Goals and tasks

Goals and tasks are plain markdown in each brain repository, so they sync with it and can be edited
in any editor:

| Space                 | File                                    |
| --------------------- | --------------------------------------- |
| A profile space       | `<profile>-brain/tasks.md`              |
| A custom space, Other | `<default brain>/tasks/<space-name>.md` |

```md
## Inbox

- [ ] Something nobody planned yet

## Ship the release

Done when the tag is pushed.

- [ ] Fix the flaky login test
      Only fails on CI. https://example.com/issue/1
  - thread: 6f1c2d8e-…
- [x] Write the changelog
```

A `## ` heading is a goal; `## [x] Title` marks it done. The prose under a heading is the goal's
notes. A top-level `- [ ]` or `- [x]` item is a task (`*` and `+` bullets work too), and the indented
lines under it are its notes. A `thread: <id>` line links the task to a thread. When a linked thread
finishes a turn successfully and all of the task's threads are finished, the task is marked done.

A file from before goals gets an `## Inbox` heading over its tasks the first time the manager reads
it; nothing else in it changes. Every edit re-reads the file first and changes only the lines it
touches, and changes made in an editor show up as soon as the file is saved. Each goal
lives in the brain of the profile it belongs to.
