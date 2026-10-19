# Sandboxes

A sandbox runs a thread in its own isolated machine: a microVM on Linux hosts with
[microsandbox](https://microsandbox.dev), otherwise a Docker container. The agent, the thread's
terminals, and the project's setup script all run inside it. Each sandbox has its own ports,
services, and installed tools, so two threads can both run an app on port 3000, or use different
database data and migrations, at the same time.

Where a thread works and whether it runs in a sandbox are separate choices. The thread's folder
(the project checkout or a worktree) stays on your machine, so diffs, checkpoints, source control,
and your editor work as usual. Sandboxed threads in the same folder share one sandbox; other
threads in that folder keep running on your machine. Sandboxed threads show a box icon in the
sidebar and a **Sandbox** badge in the thread header.

## Start a sandbox

Pick the folder for a new thread as usual, then turn on **Sandbox** next to it. To move a
running thread into a sandbox, choose **Run in sandbox** in the thread details. The first sandbox
builds a base image, which takes a few minutes. Later sandboxes start in seconds. Agents can also
start one with `sandbox: true` in any workspace strategy of a thread launch.

The machine running T3 Code needs either `msb` (microsandbox) and KVM, or Docker. T3 Code
prefers microsandbox when both are there; set `T3CODE_SANDBOX_BACKEND=docker` to choose Docker. Claude and Codex can run in a sandbox.
Other providers report an error in a sandboxed thread.

## What is inside

The image is Debian with Node 24, git, and the same Claude Code and Codex versions as your machine.
Your Claude and Codex settings and logins are shared with the sandbox, along with your git
identity. Git over SSH works through your SSH agent, which the sandbox can ask to sign but never
read keys from. If your keys are files rather than an agent, set `T3CODE_SANDBOX_SSH_KEYS` to
their paths, separated by `:`. The agent can use `sudo` to install anything else, for example
`sudo apt-get install postgresql`. Services and data outside the thread's folder stay inside that sandbox.
Config folders a thread needs later, such as a code profile's Claude folder, are added by
restarting the sandbox when nothing runs in it.

On macOS, Claude keeps its login in the Keychain, which a sandbox cannot read. Run
`claude setup-token` and add the token as `CLAUDE_CODE_OAUTH_TOKEN` to the Claude provider's
environment variables.

In a sandbox, Codex does not use its own command sandbox; the sandbox is the boundary.
Approval prompts still follow the thread's permission mode.

## Previews

When an app listens on a port inside the sandbox, T3 Code forwards it to a port on your machine
and lists it in the preview panel as `sandbox :3000`. The forwarded port stays the same across
restarts when it is free.

## Stop or leave

A sandbox goes to sleep 3 minutes after the agent finishes a turn, when no terminal or preview
uses it (`T3CODE_SANDBOX_IDLE_MINUTES`, 0 keeps it awake). A sleeping microVM gives its memory back
and uses no CPU, but everything inside keeps running from where it was; the next turn, keystroke,
or preview request wakes it. A command that runs silently in a terminal for longer than that
sleeps with it. Sandboxes stop when T3 Code stops and start again when needed. Archiving or
settling every thread of a sandbox deletes its machine; the threads stay sandboxed and get a fresh
one the next time they run. A microVM gets 2 CPUs and 4 GB of memory unless
`T3CODE_SANDBOX_CPUS` and `T3CODE_SANDBOX_MEMORY` say otherwise. **Take out of sandbox** moves a
thread's later work back to your machine. When the last thread leaves a sandbox, or is deleted,
the machine and everything in it outside the folder are deleted. Deleting a worktree removes its
sandbox.
