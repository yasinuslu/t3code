# The manager

The manager is an ordinary thread that runs your goals: it plans tasks, starts and steers worker
threads, and brings you in only for real decisions. Each code profile has its own manager. Its row
is pinned at the top of the sidebar, above every other thread, so you can reach it from wherever you are.

## Showing the manager

Click the **Manager** row at the top of the sidebar, or press `ctrl+e` (the Control key on a Mac too) or `ctrl+alt+space` (Ctrl+Option+Space
on a Mac) from any screen, Grow, a thread or settings.
The manager opens in Grow, in place of the item, with its composer focused. Press the
shortcut again to go back to where you were. A thread link in its answer opens that thread in Grow.

In the desktop app the shortcut works system-wide: from another app it brings T3 Code forward with
the manager open. If another app already owns the chord (or on a Linux Wayland session, which has
no global shortcuts), it still works while T3 Code is in front. You can also click the
speech-bubble button at the top left, or choose **Show or hide
the manager** in the command palette. Change the shortcut in
**Settings → Keybindings** under **Manager: Toggle**.

If the machine that runs the manager is offline, a notice says so instead of opening a stale chat.

## Screens

**Grow** is the main screen. Every thread link (in a message, a notification, a `t3code://` link or
the command palette) opens that thread in Grow. A thread Grow does not list, such as a settled or
archived one, opens there too, marked **not in the deck**.

For the diff, the terminal and the file panels, open the thread in **full view**: the expand button
on a thread opened in Grow, `ctrl+alt+3`, or **Open this thread in full view** in the command
palette. **Grow** at the top left, or `ctrl+alt+1`, goes back to it; `ctrl+alt+0` switches between
the two. Settings and the other pages have the same button. Archived threads are under **Settings →
Archived**.

The old Grow and Threads switch is in **Settings → General → Legacy features → Classic threads view
(deprecated)**.

## Grow

Grow shows what your agents finished today, one at a time: its screenshot or live preview in the
middle, and beside it what it is, where it came from (the thread that launched or forked it, and
what you sent it from Grow), where it stands, and what happened. Then one decision. Every return carries a proof image you can read at a glance: agents are told to add one, and when a thread finishes work without one, T3 asks it for one by itself. The list marks which returns have proof, and **Ask again** asks once more. **Ship** tells the agent to land it the way its repository lands work,
**Reply** answers its question, **Done** clears something with nothing to merge (a report),
**What if...** asks for a change in the same thread, and **Settle** takes it off the list (the same settle as the thread list, nothing is sent to the agent). Each
decision waits five seconds with **Undo**. Anything an agent is still working on, like a What
if you just sent, waits under **Working** at the top of the list. Older returns fold under **Earlier**; what is done and
what you settled stay findable below, and a settled item can be brought back. Every key sits under the left hand, so the right one can stay on the mouse. `q`/`e` move to the
previous and next item (the arrows and `j`/`k` do too). `s` ship, `d` done, `w` what if (or
reply), `x` settle, `a` asks again for proof, `z` undo. `c` opens the conversation on a narrow window (wide ones show it beside the proof), `b`/`Shift+b` or the left and right arrows
step through the screenshots, `PgDn`/`PgUp` scroll the story, `v` shows the live preview, `f` finds (`/` too), `g` opens every project in the list, and
`t` talks to the manager. `r` switches to the next profile, `Shift+r` to the previous one.
`Esc` goes back from the conversation or the manager, even from its message box.

Agents keep a status card at the top of their thread current with
the `thread_status_update` tool; its screenshots are stored with the thread, so they survive a
deleted worktree.

## One manager per profile

Every code profile with a brain (a `~/code/<profile>/<profile>-brain` repository) gets its own
manager, created in that brain's project the first time you open it. Because it works in the
profile's folder, it runs with that profile's provider settings and account. Its task and thread
tools see only its profile: its goals and tasks, and the threads of that profile's projects. Work
for another profile belongs to that profile's manager.

Switch profiles with the spaces at the top of the sidebar, or with the mouse's back and forward
buttons over the sidebar. While the manager is showing, picking a profile's space shows that
profile's manager at once. **All** shows every profile's work and keeps the manager you had;
managers themselves never see across profiles. The manager opens on the last profile you picked.

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
switcher; pick a machine to open its manager. It remembers your pick per
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
