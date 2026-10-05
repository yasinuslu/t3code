# Manager

The manager is one place to run your goals: a board of goals, their tasks and the threads working on
them, next to a manager chat that does the work. It needs code profiles: directories
`~/code/<profile>` that hold a `<profile>-brain` knowledge-base repository.

Open it with **Manager** in the sidebar's bottom row, or **Open manager** in the command palette.

## The board

- **Needs you** lists threads waiting on an approval or an answer, and threads whose last turn failed.
  Click one to open it.
- **Goals** come from every profile's brain, merged. Each goal shows its tasks, and each task the
  threads linked to it with their live state and pull requests. Tasks with no goal are under
  **Inbox**. Check a task or a goal off by hand, or let the manager do it.
- The space menu narrows the goals to one space's list.

## The manager chat

The manager is a normal agent thread that runs in the default profile's brain. Tell it what you want
done. It breaks goals into tasks, starts worker threads in your projects, steers them, answers their
routine questions and closes tasks. It brings you in for approvals and real decisions, in its chat
and in **Needs you**. It reads its rules again after a restart, and the board is built from the task
files and thread state, not from the chat. Use **Open as thread** to see the full thread.

The default profile is the one picked in the brain menu. Until you pick one, it is the profile that a
symlink directly under `~/code` points into, or else the first profile by name.

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

A file from before goals gets an `## Inbox` heading over its tasks the first time the board reads
it; nothing else in it changes. Every edit re-reads the file first and changes only the lines it
touches, and changes made in an editor show up on the board as soon as the file is saved. Each goal
lives in the brain of the profile it belongs to; the manager has to name that brain on every write.
