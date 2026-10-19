# Sandboxes

A sandbox is a new worktree that runs in its own isolated machine: a microVM on Linux hosts with
[microsandbox](https://microsandbox.dev), otherwise a Docker container. The agent, the thread's
terminals, and the project's setup script all run inside it. Each sandbox has its own ports,
services, and installed tools, so two threads can both run an app on port 3000, or use different
database data and migrations, at the same time.

The worktree's files stay on your machine. Diffs, checkpoints, source control, and your editor
work as they do for any worktree. Sandboxed threads show a box icon in the sidebar and a
**Sandbox** badge in the thread header.

## Start a sandbox

Choose **New sandbox** where you would choose **New worktree** for a new thread. The first sandbox
builds a base image, which takes a few minutes. Later sandboxes start in seconds. Agents can also start
one with `sandbox: true` in a worktree launch.

The machine running T3 Code needs either `msb` (microsandbox) and KVM, or Docker. T3 Code
prefers microsandbox when both are there; set `T3CODE_SANDBOX_BACKEND=docker` to choose Docker. Claude and Codex can run in a sandbox.
Other providers report an error in a sandboxed thread.

## What is inside

The image is Debian with Node 24, git, and the same Claude Code and Codex versions as your machine.
Your Claude and Codex settings and logins are shared with the sandbox, along with your git
identity. Git over SSH works through your SSH agent, which the sandbox can ask to sign but never
read keys from. If your keys are files rather than an agent, set `T3CODE_SANDBOX_SSH_KEYS` to
their paths, separated by `:`. The agent can use `sudo` to install anything else, for example
`sudo apt-get install postgresql`. Services and data outside the worktree stay inside that sandbox.

On macOS, Claude keeps its login in the Keychain, which a sandbox cannot read. Run
`claude setup-token` and add the token as `CLAUDE_CODE_OAUTH_TOKEN` to the Claude provider's
environment variables.

In a sandbox, Codex does not use its own command sandbox; the sandbox is the boundary.
Approval prompts still follow the thread's permission mode.

## Previews

When an app listens on a port inside the sandbox, T3 Code forwards it to a port on your machine
and lists it in the preview panel as `sandbox :3000`. The forwarded port stays the same across
restarts when it is free.

## Stop or remove

A sandbox stops by itself after 15 minutes with nothing running and no open preview
(`T3CODE_SANDBOX_IDLE_MINUTES`, 0 keeps it running). A stopped sandbox starts again the next time
the agent or a terminal needs it. A microVM gets 2 CPUs and 4 GB of memory unless
`T3CODE_SANDBOX_CPUS` and `T3CODE_SANDBOX_MEMORY` say otherwise. Removing a sandbox deletes the
machine and everything in it outside the
worktree; later work in that worktree runs on your machine. Deleting the worktree removes its
sandbox.
