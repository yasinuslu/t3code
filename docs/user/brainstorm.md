# Brainstorm

Brainstorm is a floating chat for thinking out loud about everything going on in a space. It has a
small task list next to it. It needs spaces, which come from code profiles: directories
`~/code/<profile>` that hold a `<profile>-brain` knowledge-base repository.

## Opening it

Press `Ctrl+Alt+Space` (`Ctrl+Option+Space` on a Mac), or rebind `brainstorm.toggle` in **Settings > Keybindings**. The popup opens
over whatever is on screen, for the active space. Press `Esc` or the shortcut again to close it.

In the desktop app the shortcut is also registered system-wide while T3 Code runs. It then brings
the window forward from any app. If another app already holds the shortcut, it works only inside T3
Code.

## The chat

Each space has one brainstorm chat, and it keeps its history. It is a normal agent thread that runs
in the space's brain repository, so provider settings that depend on the working directory apply.
Brainstorm chats are left out of the thread list. Use **Open as thread** to see one in full, for
example to answer an approval.

| Space           | Works in                           |
| --------------- | ---------------------------------- |
| A profile space | `~/code/<profile>/<profile>-brain` |
| A custom space  | the default profile's brain        |
| Other, All      | the default profile's brain        |

The chat is a fast front desk. It runs Claude Sonnet at low effort when a Claude provider offers
it (otherwise the project's default model); set `brainstormModelSelection` in the server settings
to pick another. In the popup, `Cmd+/` (`Ctrl+/` elsewhere) flips between Sonnet and Opus. On
Claude, the agent is told to answer in a few lines, hand research and sweeps to a background
subagent and relay its result in two lines when it finishes, and turn code changes into a thread
with `start_thread`, so the chat stays free while deep work runs.

The default profile is the one picked in the popup's brain menu, shown for spaces that are not
profile spaces. Until you pick one, it is the profile that a symlink directly under `~/code` points
into (a shared checkout linked out of its profile), or else the first profile by name.

The agent gets tools on the `t3-code` MCP server, scoped to its space. The All space sees
everything:

- Tasks: `list_tasks`, `add_task`, `update_task`, `complete_task`, `delete_task`.
- Threads: `list_threads`, `read_thread`, `list_projects`.
- Thread changes: `settle_thread`, `archive_thread`, `rename_thread`, and `set_thread_space`, which
  adds a thread's project to a custom space or removes it.
- `start_thread` starts a thread in a project with a first prompt, and can link it to a task.
- `brainstorm_overview` describes the space, its scope and where its tasks live.

Regular threads get the same tools and see every space. Their task tools default to the task list
of the thread's own project space; pass `space` to use another.

## Tasks

Tasks are a plain markdown checklist in the brain repository, so they sync with it and can be edited
in any editor:

| Space                 | Task file                                    |
| --------------------- | -------------------------------------------- |
| A profile space       | `<profile>-brain/tasks.md`                   |
| A custom space, Other | `<default brain>/tasks/<space-name>.md`      |
| All                   | shows every list; adds go to the default one |

The space name is lower-cased with dashes (`Side Quests` becomes `side-quests.md`). Renaming a custom
space starts a new file; rename the file too to keep its tasks.

```md
- [ ] Fix the flaky login test
      Only fails on CI. https://example.com/issue/1
  - thread: 6f1c2d8e-…
- [x] Ship the release
```

A task is a top-level `- [ ]` or `- [x]` item. `*` and `+` bullets work too. The indented lines under
it are its notes. A `thread: <id>` line links the task to a thread. The task list then shows that
thread's state (working, waiting on you, finished, settled). When a linked thread finishes a turn
successfully and all of the task's threads are finished, the task is marked done. Reopen it and it
stays open until one of its threads works again.
Anything else in the file, such as headings and prose, is left alone.

Edits from the popup and the agent re-read the file first and change only the lines of the one task
they touch. Changes made in an editor show up in the popup as soon as the file is saved.
