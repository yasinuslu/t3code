# Sandboxes

A sandbox is one long-running machine per worktree. See
[`SandboxService`](../../apps/server/src/sandbox/SandboxService.ts) and the
[user guide](../user/sandboxes.md).

## One T3, many sandboxes

The host T3 server stays the only source of truth: a sandbox is a runtime for one worktree, not a
T3 server of its own. Everything that does not depend on the runtime (the list, fail-closed
lookups, the relay, exec env, idle stops) lives in `SandboxService`; a
[`SandboxBackend`](../../apps/server/src/sandbox/SandboxBackend.ts) only creates, starts, stops,
removes, and execs. microsandbox (`msb`, libkrun microVMs with their own kernel) is preferred
over Docker when `msb` and `/dev/kvm` exist. A sandbox keeps the backend it was created with. A
sandbox on another host would be a third backend; a long-lived remote machine is better served
by connecting to a T3 server running there.

msb cannot build Dockerfiles, so its base image is a snapshot of a provisioned builder VM, and
`msb run --snapshot` boots sandboxes from it in about two seconds.

## The provider CLI runs inside

The point of a sandbox is separate ports and services, which only works if the commands an agent
runs share the sandbox's network. Providers have no reliable hook to redirect their shell
commands, so the whole CLI runs in the sandbox: Claude through the SDK's
`spawnClaudeCodeProcess`, Codex by wrapping the app-server command, and terminals by opening
`bash` through the backend's exec with a tty. The setup script runs in a terminal, so it follows. Other adapters
fail in `ProviderSessionManager` rather than run on the host unnoticed.

A process runs where it was opened, so a shared provider session (Codex serves every thread of an
instance from one app-server) is scoped per sandbox. The Orchestrator picks the session id from the
thread's current worktree each time a run starts, because a launch records one before the
worktree and sandbox exist. When a sandbox stops or is removed, `ProviderSessionManager` releases
the sessions that ran in it, so the next turn opens a fresh one and restarts the sandbox.

The image installs Claude Code and Codex at the host's versions. Host binaries can be macOS
builds, so they are never mounted.

## Same paths inside and out

The worktree, the repository's git dir, `~/.claude`, `~/.codex`, `~/.gitconfig`, the attachments
folder, and the project checkout (read-only, for setup scripts) mount at their host paths, and the image user has the host's uid, gid, and home
path. T3 keeps reading worktree files, Claude session files, and git state on the host without any
path translation. `~/.claude.json` is copied in, not mounted, because Claude replaces it by rename,
which fails on a bind-mounted file.

A microVM shares folders over virtiofs and cannot mount the Nix store, so links a mounted config
folder has to files outside every mount (home-manager's) are copied in at every start, as are
`~/.ssh/config` and `~/.ssh/known_hosts`. The `~/.ssh` folder itself is never mounted.

## Env travels in a file

Exec flags need values in argv, where any local process can read them. A command's env is written
to a 0600 file in the sandbox's control folder (`<state>/sandboxes/<name>/`, mounted at its own
path), which the launcher sources and deletes before `exec`.

## Git without keys inside

Host git config often points at host-only programs (a Nix wrapper for `core.sshCommand`, a
password manager signer). Sandboxed commands get the host's identity for the worktree, an
`IdentityAgent` pointing at an SSH agent socket the relay forwards from the host, and SSH commit
signing through that agent when `T3CODE_SANDBOX_SSH_KEYS` loaded the signing key; otherwise
signing is turned off for sandboxed commits rather than failing them. Pagers that live in the
Nix store fall back to `less`.

## msb exec cannot stream

`msb exec` (0.5) reads a non-tty command's whole stdin before starting it, so anything that
talks over stdio (the relay, provider CLIs) would never start. msb sandboxes publish one port
instead, and [`sandboxExecServer.ts`](../../apps/server/src/sandbox/sandboxExecServer.ts) runs
behind it: piped commands go through a small host client that frames stdio and the exit status
over that socket, authenticated by a token kept in T3's state. Tty commands (terminals) still use
`msb exec --tty`, which streams. msb also never fails on a busy host port, so T3 picks a free one
itself, and it mounts in the order given, so mounts are sorted parents first.

## One relay for every other port

Sandbox IPs are not routable from the host (Docker Desktop, msb's NAT), and a server bound to
`127.0.0.1` is not reachable from inside. [`SandboxTunnel`](../../apps/server/src/sandbox/SandboxTunnel.ts)
avoids both: a Node relay runs under the backend's exec and multiplexes TCP and Unix sockets over its stdio. It
forwards every port that starts listening in the sandbox to a host loopback port, and listens
on T3's own port inside the sandbox so the unchanged `127.0.0.1` MCP URL reaches the host. The SSH agent crosses the same way, as a
Unix socket inside. The relay's open connections and last traffic also drive idle stops.

## Killing the exec client kills nothing

Killing a `docker exec` or `msb exec` client leaves its process running in the sandbox. Every sandboxed
command starts through a launcher that records its PID, and each spawn site calls `release` when
its process exits or is killed. Each exec leads its own session, so `release` kills the whole
session, including children whose parent already exited. The first use after a server restart
kills everything an earlier server process left behind.

## Codex's own sandbox is off

Codex's bubblewrap sandbox cannot create namespaces in an unprivileged container, and the microVM
is already the boundary. Sandboxed turns
send `dangerFullAccess` and keep the runtime mode's approval policy.

## Fail closed

A worktree is registered and saved as sandboxed before the image build, and stays registered when
provisioning fails, so a terminal or turn waits or fails instead of running on the host. A
sandboxed worktree whose sandbox is missing gets a new one. Sandboxes carry labels with their
worktree, CLI versions, and an owner hash of the server's state directory, so a lost or unreadable
list is rebuilt from the sandboxes this server owns. Each sandboxed worktree also keeps its record
in `t3code-sandbox.json` in its git admin folder, so a lookup can rebuild the sandbox from the
worktree itself even when both the list and its sandbox are gone. Entries for deleted worktrees
are dropped at startup.
