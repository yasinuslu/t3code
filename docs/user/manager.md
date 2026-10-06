# Home and the manager

**Home** is where you follow all of your work. It shows every thread as a card next to the manager,
one ordinary thread that runs your goals: it plans tasks, starts and steers worker threads in any
project, and brings you in only for real decisions.

## Getting Home

Press `ctrl+alt+m` from anywhere. The same keys are the way back from any thread. You can also click
**Home** at the top of the sidebar or the compass at the start of a thread's header, or choose **Go
home** in the command palette. Home opens with the manager's composer focused. Change the shortcut in
**Settings → Keybindings** under **Manager: Open**.

## The work cards

A banner at the top says in one line what needs you, or what is moving. Below it, threads from every
connected machine are grouped:

- **Needs you**: waiting on an approval or an answer, or the last turn failed.
- **Working**: running a turn or waiting on their own background work.
- **Ready for review**: finished threads you have not settled.
- **Recently done**: threads settled in the last day.

Each card shows the thread's state, project, profile and machine, then **Try it** for the dev
servers and preview pages the thread points at, **Open thread**, and its pull requests. Under them
are the first lines of the thread's latest report, its screenshots, and any open questions it asked.
**Goals** from every brain follow, with their progress and open tasks.

## The manager

The manager is docked on the right of Home as a normal thread view. On narrow windows, open it from
the sidebar, where it is pinned and marked with a compass. A thread that is the manager shows a
**Manager** badge in its header.

The first time, T3 Code creates the manager in the default profile's brain project (a
`~/code/<profile>/<profile>-brain` repository); without a brain it uses the project you used most
recently. The default profile is the one that a symlink directly under `~/code` points into, or
else the first profile by name. Unpin, rename or archive it like any thread; after archiving, Home
starts a new one.

Tell it what you want done. It breaks goals into tasks, starts worker threads, answers their routine
questions and closes tasks. It reads its rules again after a restart, so nothing depends on its chat
history.

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

A file from before goals gets an `## Inbox` heading over its tasks the first time the manager or Home reads
it; nothing else in it changes. Every edit re-reads the file first and changes only the lines it
touches, and changes made in an editor show up on Home as soon as the file is saved. Each goal
lives in the brain of the profile it belongs to; the manager has to name that brain on every write.
