import type * as Effect from "effect/Effect";

import type { SandboxBackendKind } from "@t3tools/contracts";

/**
 * What runs a sandbox: Docker containers or microsandbox microVMs today, and
 * possibly a remote host later. `SandboxService` owns everything that does not
 * depend on the runtime (the registry, fail-closed lookups, the stdio relay,
 * exec env, idle stops) and asks the backend only for these lifecycle steps.
 *
 * Every backend keeps the same contract: mounts land at their host paths, the
 * sandbox user has the host's uid, gid, and home, and `execArgs` runs a
 * command inside with stdio piped, so the relay and provider CLIs work alike.
 */
export interface SandboxBackend {
  readonly kind: SandboxBackendKind;
  /** Name shown in errors and docs, e.g. "Docker". */
  readonly label: string;
  /** CLI that `execArgs` and every lifecycle call runs. */
  readonly command: string;
  /**
   * The CLI's exec cannot stream stdin without a tty, so commands that talk
   * over stdio go through the exec server (see `sandboxExecServer.ts`) on a
   * published host port instead.
   */
  readonly execServer: boolean;
  /** The host port the sandbox publishes the exec server on, when it has one. */
  readonly execHostPort: (name: string) => Effect.Effect<number | null>;
  /** Fails with a readable reason when the runtime is missing or not running. */
  readonly ensureAvailable: (workspacePath: string) => Effect.Effect<void, SandboxBackendError>;
  /** Builds the base image when missing and returns its reference. */
  readonly ensureImage: (
    spec: SandboxImageSpec,
    onOutput: (line: string) => void,
  ) => Effect.Effect<string, SandboxBackendError>;
  /** Creates and starts a sandbox, replacing one left under the same name. */
  readonly create: (spec: SandboxCreateSpec) => Effect.Effect<void, SandboxBackendError>;
  readonly state: (name: string) => Effect.Effect<SandboxInstanceState>;
  readonly start: (name: string, workspacePath: string) => Effect.Effect<void, SandboxBackendError>;
  readonly stop: (name: string, workspacePath: string) => Effect.Effect<void, SandboxBackendError>;
  /**
   * Hands the guest's free memory back to the host and freezes the sandbox:
   * no CPU, every process inside keeps its state. Backends without it stop
   * idle sandboxes instead.
   */
  readonly sleep?: (
    name: string,
    workspacePath: string,
  ) => Effect.Effect<void, SandboxBackendError>;
  /** Undoes `sleep`. A no-op on a sandbox that is not asleep or not running. */
  readonly wake?: (name: string, workspacePath: string) => Effect.Effect<void, SandboxBackendError>;
  /** Deletes the sandbox. Succeeds when it is already gone. */
  readonly remove: (
    name: string,
    workspacePath: string,
  ) => Effect.Effect<void, SandboxBackendError>;
  /** Sandboxes labeled with this server's owner hash, for adoption after a lost registry. */
  readonly listOwned: Effect.Effect<ReadonlyArray<SandboxOwnedInstance>, SandboxBackendError>;
  /** Arguments for `command` that run `argv` inside the sandbox with stdio piped. */
  readonly execArgs: (input: {
    readonly name: string;
    readonly cwd?: string | undefined;
    readonly tty: boolean;
    readonly root?: boolean | undefined;
    readonly argv: ReadonlyArray<string>;
  }) => ReadonlyArray<string>;
}

export type SandboxInstanceState = "running" | "stopped" | "missing";

export interface SandboxCliVersions {
  readonly claude: string;
  readonly codex: string;
}

export interface SandboxMount {
  readonly path: string;
  readonly readOnly: boolean;
  /** A single file rather than a folder. Some backends mount the two differently. */
  readonly file?: boolean | undefined;
}

export interface SandboxImageSpec {
  readonly uid: number;
  readonly gid: number;
  readonly home: string;
  readonly versions: SandboxCliVersions;
}

export interface SandboxCreateSpec {
  readonly name: string;
  readonly workspacePath: string;
  readonly image: string;
  readonly versions: SandboxCliVersions;
  readonly mounts: ReadonlyArray<SandboxMount>;
  readonly uid: number;
  readonly gid: number;
  readonly home: string;
  /** Docker disables IPv6 in containers by default; a server bound to ::1 needs it on loopback. */
  readonly ipv6Loopback: boolean;
  /** Host loopback port for the exec server, for backends with `execServer`. */
  readonly execHostPort?: number | undefined;
  /** The thread the sandbox was created for and this server's environment, as labels for host tooling. */
  readonly threadId?: string | undefined;
  readonly environmentId?: string | undefined;
}

export interface SandboxOwnedInstance {
  readonly name: string;
  readonly workspacePath: string;
  readonly image: string;
  readonly versions: SandboxCliVersions;
  readonly mounts: ReadonlyArray<SandboxMount>;
  readonly running: boolean;
}

export interface SandboxBackendError {
  readonly operation: "create" | "start" | "exec" | "stop" | "remove";
  readonly workspacePath: string;
  readonly detail: string;
  readonly cause?: unknown;
}

/** Labels on every sandbox T3 creates. Sandboxes carry enough to be adopted. */
export const SANDBOX_LABELS = {
  sandbox: "t3code.sandbox",
  /** Hash of the owning server's state dir, so servers on one machine never adopt each other's. */
  owner: "t3code.sandbox.owner",
  workspace: "t3code.sandbox.workspace",
  claude: "t3code.sandbox.claude",
  codex: "t3code.sandbox.codex",
} as const;

/**
 * Commands that turn a Debian Node image into the sandbox image: tools agents
 * expect, Claude Code and Codex pinned to the host's versions, and a user
 * whose uid, gid, and home path match the host. Matching ids keep files the
 * agent writes in the worktree owned by the user; matching the home path lets
 * provider config folders mount at the same paths. The user has passwordless
 * sudo so agents can install services like databases in their own sandbox.
 */
export const sandboxProvisionScript = (spec: SandboxImageSpec): string =>
  [
    "set -e",
    "apt-get update",
    "apt-get install -y --no-install-recommends sudo ripgrep jq less procps lsof iproute2 openssh-client",
    "rm -rf /var/lib/apt/lists/*",
    `npm install -g "@anthropic-ai/claude-code@${spec.versions.claude}" "@openai/codex@${spec.versions.codex}"`,
    "npm cache clean --force",
    "userdel -r node 2>/dev/null || true",
    `getent group "${spec.gid}" >/dev/null || groupadd -g "${spec.gid}" t3`,
    `useradd -o -u "${spec.uid}" -g "${spec.gid}" -d "${spec.home}" -m -s /bin/bash t3`,
    'echo "t3 ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/t3',
    "chmod 0440 /etc/sudoers.d/t3",
  ].join("\n");

/** Env every sandbox command starts with, on top of the image's own. */
export const sandboxBaseEnv = (home: string): Readonly<Record<string, string>> => ({
  HOME: home,
  SHELL: "/bin/bash",
});
