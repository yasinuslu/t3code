# Manager

The manager is one ordinary thread that runs your goals: it plans tasks, starts and steers worker
threads in any project, and brings you in only for real decisions. The work overlay shows how
everything is going at a glance.

## The manager thread

Press `ctrl+alt+m` from anywhere, or choose **Open manager thread** in the command palette. The
manager opens like any other thread, with its composer focused. The first time, T3 Code creates it in
the default profile's brain project (a `~/code/<profile>/<profile>-brain` repository). Without a
brain it uses the project you used most recently. The manager is pinned in the sidebar and marked
with a compass. Unpin, rename or archive it like any thread; after archiving, the shortcut starts a
new one.

Tell it what you want done. It breaks goals into tasks, starts worker threads, answers their routine
questions and closes tasks. It reads its rules again after a restart, so nothing depends on its chat
history. The default profile is the one that a symlink directly under `~/code` points into, or else
the first profile by name.

## The work overlay

Press `ctrl+alt+o`, choose **Work** at the bottom of the sidebar, or **Show work overview** in the
command palette. The overlay opens above the current view; Esc or the same shortcut closes it.

- **Needs you**: threads waiting on an approval or an answer, and threads whose last turn failed.
- **Working**: threads running a turn or waiting on their own background work.
- **Ready for review**: finished threads you have not settled.
- **Recently done**: threads settled in the last day.
- **Goals**: every brain's open goals with their progress and open tasks.

Each thread shows its project, profile, branch, pull requests, open preview pages and time since its
last activity. Click a thread to open it. Threads from every connected environment are listed, and a
thread on another machine names it. Goals come from the environment you are connected to first.

Both shortcuts can be changed in **Settings → Keybindings** (**Manager: Open** and **Work Overlay:
Toggle**).

The manager's tools are on the `t3-code` MCP server: `manager_overview` (its rules, every profile's
brain and task file), `list_tasks`, `add_goal`, `update_goal`, `delete_goal`, `add_task`,
`update_task`, `complete_task`, `delete_task`, `list_threads` (every project's threads with a
one-word status) and `set_thread_space`. The `t3_thread_*`, `t3_pending_request_*` and
`t3_thread_search` tools reach every project's threads for the manager, and only the calling
project's threads for any other thread. The manager starts workers with `t3_thread_launch`.

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

A file from before goals gets an `## Inbox` heading over its tasks the first time the manager or the overlay reads
it; nothing else in it changes. Every edit re-reads the file first and changes only the lines it
touches, and changes made in an editor show up in the work overlay as soon as the file is saved. Each goal
lives in the brain of the profile it belongs to; the manager has to name that brain on every write.
