# Home and the manager

**Home** is where you follow your work. It shows threads as cards next to the manager, an ordinary
thread that runs your goals: it plans tasks, starts and steers worker threads, and brings you in only
for real decisions. Each code profile has its own manager.

## Getting Home

Press `ctrl+alt+m` from anywhere. The same keys are the way back from any thread. You can also click
**Home** at the top of the sidebar or the compass at the start of a thread's header, or choose **Go
home** in the command palette. Home opens with the manager's composer focused. Change the shortcut in
**Settings → Keybindings** under **Manager: Open**.

## The work cards

A banner at the top says in one line what needs you, or what is moving. Below it, the active space's
threads from every connected machine are grouped:

- **Needs you**: waiting on an approval or an answer, or the last turn failed.
- **Working**: running a turn or waiting on their own background work.
- **Ready for review**: finished threads you have not settled.
- **Recently done**: threads settled in the last day.

Each card shows the thread's state, project, profile and machine, then **Try it** for the dev
servers and preview pages the thread points at, **Open thread**, and its pull requests. Under them
are the first lines of the thread's latest report, its screenshots, and any open questions it asked.
Click a screenshot to see all of the card's screenshots full size; arrow keys or a swipe move between
them. Agents can keep the card current while they work with the `thread_status_update` tool, and its
screenshots are stored with the thread, so they survive a deleted worktree. The same card sits at the
top of the thread itself; collapse it to one line with its header.
**Goals** from the active space's brain follow (every brain's under **All**), with their progress and
open tasks.

## The manager

The manager is docked on the right of Home as a normal thread view. It has no row in the sidebar's
thread list; **Home** at the top of the sidebar opens it, and on narrow windows that opens the
manager thread itself. A thread that is the manager shows a **Manager** badge in its header.

## One manager per profile

Every code profile with a brain (a `~/code/<profile>/<profile>-brain` repository) gets its own
manager, created in that brain's project the first time you open it. Because it works in the
profile's folder, it runs with that profile's provider settings and account. Its task and thread
tools see only its profile: its goals and tasks, and the threads of that profile's projects. Work
for another profile belongs to that profile's manager.

Switch profiles with the switcher in Home's header. Picking a profile shows its manager and makes
its space the active space, so the cards, goals and sidebar follow. **All** shows every profile's
cards and goals and keeps the manager you had; managers themselves never see across profiles.
Switching spaces in the sidebar switches the manager too, and Home opens on the last profile you
picked. On narrow windows, open the manager with the button in Home's header; a manager opened as
a page has the same switcher next to its **Manager** badge.

Before you pick one, Home shows the default profile's manager: the profile that a symlink directly
under `~/code` points into, or else the first profile by name. Without any profile brain there is
one manager for everything, in the project you used most recently. Unpin, rename or archive a manager
like any thread; after archiving, Home starts a new one.

The managers run on the machine you connected to, unless one of your connected machines has
**Settings → General → Host the manager** turned on: then every device opens the managers, their goals
and their tasks on that machine, and its tools reach that machine's threads. Turn it on for a machine
that stays on, so the manager keeps working while a laptop is closed. While that machine is offline,
Home says so instead of opening a manager elsewhere.

To run each profile's manager where that profile's work happens, list the profiles in **Settings →
General → Managers hosted here** on each machine (for example `sn` on a laptop, `yu` on a desktop).
A machine that lists profiles runs only those managers. Every device that connects to both
machines opens each manager on the machine that lists it.

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

A file from before goals gets an `## Inbox` heading over its tasks the first time the manager or Home reads
it; nothing else in it changes. Every edit re-reads the file first and changes only the lines it
touches, and changes made in an editor show up on Home as soon as the file is saved. Each goal
lives in the brain of the profile it belongs to.
