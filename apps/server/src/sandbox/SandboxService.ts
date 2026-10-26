// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off - spawns the sandbox CLI for relays, sync exec plans, and env files; idle times are wall-clock.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import {
  ThreadId,
  type SandboxBackendKind,
  type SandboxListStreamEvent,
  type SandboxStatus,
  type SandboxSummary,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as ProcessRunner from "../processRunner.ts";
import type {
  SandboxBackend,
  SandboxBackendError,
  SandboxCliVersions,
  SandboxMount,
} from "./SandboxBackend.ts";
import {
  isMountablePath,
  preferredSandboxHostPort,
  renderSandboxEnvFile,
  sandboxContainerName,
  sandboxEnvNames,
  sandboxExecLauncherArgs,
  sandboxOwner,
} from "./sandboxCommon.ts";
import { makeDockerBackend, type SandboxCli } from "./sandboxDocker.ts";
import { makeMicrosandboxBackend, microsandboxResources } from "./sandboxMicrosandbox.ts";
import {
  SANDBOX_EXEC_CLIENT_SOURCE,
  SANDBOX_EXEC_GUEST_PORT,
  SANDBOX_EXEC_SERVER_SOURCE,
} from "./sandboxExecServer.ts";
import { SANDBOX_KILL_SOURCE, SANDBOX_RELAY_SOURCE, SandboxTunnel } from "./SandboxTunnel.ts";

export class SandboxError extends Schema.TaggedError<SandboxError>()("SandboxError", {
  operation: Schema.Literals(["create", "start", "exec", "stop", "remove"]),
  workspacePath: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Runs commands inside one sandbox. Plain functions, so sync spawn callbacks can use it. */
export interface SandboxExecTarget {
  readonly workspacePath: string;
  readonly containerName: string;
  /**
   * Backend CLI command that runs `command` inside the sandbox. The caller
   * spawns it and calls `release` when it exits or is killed: killing the
   * CLI client alone leaves the command running in the sandbox.
   * Throws `SandboxError` when the env needs a folder the sandbox cannot see.
   */
  readonly command: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly tty: boolean;
  }) => SandboxCommand;
}

export interface SandboxCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Env for the CLI client itself. The command's own env travels in a file. */
  readonly env: NodeJS.ProcessEnv;
  /** Kills the command's processes in the sandbox. Safe to call more than once. */
  readonly release: () => void;
}

export interface SandboxForwardedPort {
  readonly workspacePath: string;
  readonly containerPort: number;
  readonly hostPort: number;
}

/** A thread's work, as callers that run commands know it. */
export interface SandboxThreadRef {
  readonly threadId: string;
  /** Where the command runs. It must be inside the thread's sandbox workspace. */
  readonly cwd: string;
}

/** Threads whose sandbox processes are gone: it stopped, was removed, or they left it. */
export interface SandboxStoppedEvent {
  readonly workspacePath: string;
  /** Threads that moved in or out of the sandbox, or all of its threads when it stopped. */
  readonly threadIds: ReadonlyArray<string>;
  /** The sandbox's processes are gone, not just some threads moved. */
  readonly processesStopped: boolean;
}

/**
 * Sandboxes for threads. A sandbox is one long-running container or microVM
 * (see `SandboxBackend`) that mounts a workspace (a project checkout or a
 * worktree, plus the repository's git dir) at the same path, plus the user's
 * Claude and Codex config folders. A thread joins a sandbox independently of
 * how its workspace was made; sandboxed threads in one workspace share its
 * sandbox, other threads there stay on the host. Their agents, terminals, and
 * setup scripts run in it through the backend's exec, so parallel threads get
 * separate ports, services, and machine state while T3 keeps reading the
 * workspace on the host.
 *
 * A thread is recorded as sandboxed before anything slow happens, and stays
 * recorded when provisioning fails, so its work fails instead of running on
 * the host. The list is persisted, and sandboxes carry labels that rebuild it
 * if the file is lost.
 */
export class SandboxService extends Context.Service<
  SandboxService,
  {
    /** Whether this host can run sandboxes at all: Linux and macOS. */
    readonly supported: boolean;
    /** The runtime new sandboxes use. */
    readonly backend: SandboxBackendKind;
    /**
     * Records the thread as sandboxed in `workspacePath` and saves it,
     * creating the workspace's sandbox record when it has none. Fast; call it
     * before anything of the thread can run, then `start`. `providers`
     * supplies the Claude and Codex versions to install; their home folders,
     * plus `homes` (see `sandboxProviderHomes`), are mounted.
     */
    readonly attach: (input: {
      readonly threadId: string;
      readonly workspacePath: string;
      /** The project checkout, mounted read-only for setup scripts that copy or link from it. */
      readonly projectRoot: string;
      readonly providers: ReadonlyArray<ServerProvider>;
      readonly homes: ReadonlyArray<string>;
    }) => Effect.Effect<void, SandboxError>;
    /** Builds the image if needed, then creates and starts the thread's sandbox. */
    readonly start: (input: {
      readonly threadId: string;
      readonly onOutput?: (line: string) => Effect.Effect<void>;
    }) => Effect.Effect<SandboxSummary, SandboxError>;
    /**
     * The started sandbox the thread runs in, or none for a host thread.
     * `homes` are config folders the command will use: one the sandbox does
     * not mount yet is added by recreating the sandbox when nothing runs in it.
     */
    readonly execTarget: (
      ref: SandboxThreadRef & { readonly homes?: ReadonlyArray<string> },
    ) => Effect.Effect<Option.Option<SandboxExecTarget>, SandboxError>;
    /**
     * The workspace of the thread's sandbox: the one it was attached to, or
     * one adopted without its thread list that owns `cwd`.
     */
    readonly workspaceOf: (
      threadId: string,
      cwd: string | null,
    ) => Effect.Effect<string | undefined>;
    /** Whether the thread runs in a sandbox. Does not start anything. */
    readonly isSandboxed: (ref: SandboxThreadRef) => Effect.Effect<boolean>;
    /**
     * A provider turn started for the thread: wakes its sandbox, which then
     * stays awake until `turnEnded` with the same key (the provider session).
     */
    readonly turnStarted: (
      input: SandboxThreadRef & { readonly key: string },
    ) => Effect.Effect<void, SandboxError>;
    readonly turnEnded: (key: string) => void;
    /** Something of the thread is in use (a terminal keystroke): wakes its sandbox soon. */
    readonly touch: (ref: SandboxThreadRef) => void;
    /**
     * The thread was archived or settled. Once every thread of the sandbox is,
     * its VM is deleted; the threads stay sandboxed and get a fresh one on use.
     */
    readonly retire: (threadId: string) => Effect.Effect<void, SandboxError>;
    /** The thread was unarchived or unsettled. */
    readonly unretire: (threadId: string) => void;
    /** Stops the thread's sandbox. The next command there starts it again. */
    readonly stop: (threadId: string) => Effect.Effect<void, SandboxError>;
    /**
     * Takes the thread out of its sandbox; its later work runs on the host.
     * The sandbox is deleted when no thread is left in it.
     */
    readonly detach: (threadId: string) => Effect.Effect<void, SandboxError>;
    /** Deletes the sandbox of a workspace that is going away, with all its threads. */
    readonly remove: (workspacePath: string) => Effect.Effect<void, SandboxError>;
    readonly list: Effect.Effect<ReadonlyArray<SandboxSummary>>;
    /** Emits the full list first, then after every change. */
    readonly stream: Stream.Stream<SandboxListStreamEvent>;
    /** Every forwarded sandbox port, for preview discovery. */
    readonly forwardedPorts: () => ReadonlyArray<SandboxForwardedPort>;
    /**
     * Threads whose sandbox processes are gone, and threads that moved in or
     * out of a sandbox. Sessions holding processes for them are dead or run
     * in the wrong place.
     */
    readonly stopped: Stream.Stream<SandboxStoppedEvent>;
  }
>()("t3/sandbox/SandboxService") {}

const Mount = Schema.Struct({
  path: Schema.String,
  readOnly: Schema.Boolean,
  file: Schema.optional(Schema.Boolean),
});

const RegistryEntry = Schema.Struct({
  workspacePath: Schema.String,
  /** Missing on sandboxes adopted from labels: their threads are unknown. */
  threadIds: Schema.optional(Schema.Array(Schema.String)),
  containerName: Schema.String,
  /** Lists saved before the backend was recorded hold Docker sandboxes. */
  backend: Schema.optional(Schema.Literals(["docker", "microsandbox"])),
  image: Schema.String,
  versions: Schema.Struct({ claude: Schema.String, codex: Schema.String }),
  mounts: Schema.Array(Mount),
});
type RegistryEntry = typeof RegistryEntry.Type;
const RegistryFile = Schema.Struct({
  version: Schema.Literal(1),
  /** Saved while an unreadable list has not been rebuilt from the backend yet. */
  unverified: Schema.optional(Schema.Boolean),
  sandboxes: Schema.Array(RegistryEntry),
});
const RegistryJson = Schema.fromJsonString(RegistryFile);
const decodeRegistry = Schema.decodeUnknownEffect(RegistryJson);
const encodeRegistry = Schema.encodeEffect(RegistryJson);
const MarkerJson = Schema.fromJsonString(RegistryEntry);
const decodeMarker = Schema.decodeUnknownEffect(MarkerJson);
const encodeMarker = Schema.encodeEffect(MarkerJson);
/**
 * Kept in the workspace's own git admin folder: `.git` of a checkout, or the
 * folder a linked worktree's `.git` file points to, which `git worktree
 * remove` deletes.
 */
const MARKER_FILE = "t3code-sandbox.json";

interface SandboxRecord {
  readonly workspacePath: string;
  /** The threads that run here. */
  readonly threadIds: Set<string>;
  /**
   * Adopted from labels after the list was lost, so which threads ran here
   * is unknown: every thread working in the workspace runs here until one
   * is attached or detached explicitly.
   */
  threadsUnknown: boolean;
  readonly containerName: string;
  readonly backend: SandboxBackendKind;
  readonly versions: SandboxCliVersions;
  mounts: ReadonlyArray<SandboxMount>;
  /** Empty until the first image build finishes. */
  image: string;
  status: SandboxStatus;
  error: string | null;
  tunnel: SandboxTunnel | null;
  /** Commands left running by an earlier server process were killed. */
  reaped: boolean;
  /** Commands started through `command` that have not been released. */
  activeExecs: number;
  /** When the sandbox was last used, for idle sleep. */
  lastUsedAt: number;
  /** Frozen by `sleep`: every exec hangs until `wake`. */
  sleeping: boolean;
  /** Provider sessions running a turn here; the sandbox never sleeps under one. */
  readonly turns: Set<string>;
  /** Threads that were archived or settled; once all are, the VM is deleted. */
  readonly retired: Set<string>;
  /** Host port of the exec server, for backends that need one. Read from the backend once known. */
  execPort: number | null;
  readonly lock: Semaphore.Semaphore;
}

const SUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["linux", "darwin"]);
const SANDBOX_DRIVERS = { claude: "claudeAgent", codex: "codex" } as const;
/** Where the forwarded SSH agent listens inside every sandbox. */
const GUEST_SSH_AGENT = "/tmp/t3-ssh-agent.sock";
/** Reverse socket key for the SSH agent; never a valid TCP port. */
const SSH_AGENT_KEY = 0;
/** Small config files a mounted folder links to are copied in; anything bigger is skipped. */
const MAX_LINKED_FILE_BYTES = 1024 * 1024;

const containsPath = (root: string, candidate: string, separator: string) =>
  candidate === root || candidate.startsWith(root.endsWith(separator) ? root : root + separator);

/** The version T3 runs for a driver: its default instance first, then any enabled one. */
const providerVersion = (providers: ReadonlyArray<ServerProvider>, driver: string) =>
  (
    providers.find((provider) => provider.instanceId === driver && provider.version) ??
    providers.find((provider) => provider.driver === driver && provider.enabled && provider.version)
  )?.version ?? "latest";

/**
 * Claude and Codex home folders configured in settings: the built-in
 * providers, provider instances, and their CLAUDE_CONFIG_DIR or CODEX_HOME.
 * Sandboxes mount them so any of those providers can run inside.
 */
export const sandboxProviderHomes = (settings: ServerSettings): ReadonlyArray<string> => {
  const homes: Array<string> = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      homes.push(expandHomePath(value.trim(), NodeOS.homedir()));
    }
  };
  // Code profiles pick Claude's folder per project, including the folders
  // account balancing switches a thread between.
  for (const profile of Object.values(settings.codeProfiles)) {
    add(profile.claude?.configDir);
    for (const dir of profile.claude?.extraConfigDirs ?? []) add(dir);
  }
  for (const instance of Object.values(settings.providerInstances)) {
    if (!Object.values(SANDBOX_DRIVERS).some((driver) => driver === instance.driver)) continue;
    const config = instance.config;
    if (typeof config === "object" && config !== null) {
      if ("homePath" in config) add(config.homePath);
      if ("shadowHomePath" in config) add(config.shadowHomePath);
    }
    for (const variable of instance.environment ?? []) {
      if (variable.name === "CODEX_HOME" || variable.name === "CLAUDE_CONFIG_DIR") {
        add(variable.value);
      }
    }
  }
  return homes;
};

/**
 * The runtime for new sandboxes: `T3CODE_SANDBOX_BACKEND` when set, otherwise
 * microsandbox when `msb` is installed and the machine has KVM, otherwise
 * Docker. Existing sandboxes keep the backend they were created with.
 */
export const resolveSandboxBackendKind = (input: {
  readonly env: NodeJS.ProcessEnv;
  readonly hasMicrosandbox: boolean;
}): SandboxBackendKind => {
  const requested = input.env.T3CODE_SANDBOX_BACKEND?.trim().toLowerCase();
  if (requested === "docker" || requested === "microsandbox") return requested;
  return input.hasMicrosandbox ? "microsandbox" : "docker";
};

const onPath = (env: NodeJS.ProcessEnv, command: string) =>
  (env.PATH ?? "")
    .split(":")
    .filter((dir) => dir.length > 0)
    .some((dir) => {
      try {
        NodeFS.accessSync(`${dir}/${command}`, NodeFS.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

/** Minutes without a turn, command, or relay traffic before a sandbox sleeps. 0 keeps them awake. */
const idleMinutes = (env: NodeJS.ProcessEnv) => {
  const value = Number.parseInt(env.T3CODE_SANDBOX_IDLE_MINUTES ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : 3;
};

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const environment = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironment);
  const environmentId = Option.isSome(environment)
    ? yield* environment.value.getEnvironmentId
    : undefined;
  const httpServer = yield* HttpServer.HttpServer;
  const supported = SUPPORTED_PLATFORMS.has(platform);
  const hostEnv = { ...process.env };
  const home = NodeOS.homedir();
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const sandboxDir = path.join(serverConfig.stateDir, "sandboxes");
  const registryPath = path.join(serverConfig.stateDir, "sandboxes.json");
  const owner = sandboxOwner(serverConfig.stateDir);
  const records = new Map<string, SandboxRecord>();
  const changes = yield* PubSub.unbounded<void>();
  const stoppedThreads = yield* PubSub.unbounded<SandboxStoppedEvent>();
  const registryLock = yield* Semaphore.make(1);
  // Lookups wait until labeled sandboxes missing from the saved list are adopted.
  const ready = yield* Deferred.make<void>();
  // Set while an unreadable list has not been rebuilt yet. Then no T3
  // worktree can be shown to be unsandboxed, so lookups there fail.
  let unverified = false;

  const fail =
    (operation: SandboxError["operation"], workspacePath: string, detail: string) =>
    (cause?: unknown) =>
      new SandboxError({
        operation,
        workspacePath,
        detail,
        ...(cause === undefined ? {} : { cause }),
      });
  const fromBackend = (error: SandboxBackendError) =>
    new SandboxError({
      operation: error.operation,
      workspacePath: error.workspacePath,
      detail: error.detail,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });

  /** Runs a short backend CLI command and returns trimmed stdout, failing on a non-zero exit. */
  const cliFor =
    (command: string): SandboxCli =>
    (operation, workspacePath, args, options = {}) => {
      let partial = "";
      const onChunk =
        options.onLine === undefined
          ? undefined
          : (chunk: Uint8Array) => {
              const lines = (partial + Buffer.from(chunk).toString("utf8")).split("\n");
              partial = lines.pop() ?? "";
              for (const line of lines) if (line.trim().length > 0) options.onLine!(line);
            };
      return processRunner
        .run({
          command,
          args,
          env: hostEnv,
          maxOutputBytes: 4 * 1024 * 1024,
          outputMode: "truncate",
          timeout: `${options.timeoutMs ?? 120_000} millis`,
          // Always close stdin: msb exec waits for its end before running anything.
          stdin: options.stdin ?? "",
          ...(onChunk === undefined ? {} : { onStdoutChunk: onChunk, onStderrChunk: onChunk }),
        })
        .pipe(
          Effect.mapError((cause): SandboxBackendError => ({
            operation,
            workspacePath,
            detail:
              cause._tag === "ProcessTimeoutError"
                ? `${command} ${args[0]} timed out.`
                : cause._tag === "ProcessSpawnError"
                  ? `${command} is not installed or not on PATH.`
                  : `${command} ${args[0]} failed: ${cause.message}`,
            cause,
          })),
          Effect.flatMap((result) =>
            result.code === 0
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail<SandboxBackendError>({
                  operation,
                  workspacePath,
                  detail: `${command} ${args[0]} failed: ${(result.stderr.trim() || result.stdout.trim()).slice(-400)}`,
                }),
          ),
        );
    };

  const backends: Record<SandboxBackendKind, SandboxBackend> = {
    docker: makeDockerBackend({ cli: cliFor("docker"), owner, registryPath }),
    microsandbox: makeMicrosandboxBackend({
      cli: cliFor("msb"),
      owner,
      registryPath,
      resources: microsandboxResources(hostEnv),
      kvmAvailable: () => fileSystem.exists("/dev/kvm").pipe(Effect.orElseSucceed(() => false)),
      systemctl: cliFor("systemctl"),
    }),
  };
  const defaultBackend = resolveSandboxBackendKind({
    env: hostEnv,
    hasMicrosandbox:
      platform === "linux" && onPath(hostEnv, "msb") && NodeFS.existsSync("/dev/kvm"),
  });
  const backendOf = (record: { readonly backend: SandboxBackendKind }) => backends[record.backend];

  // Agents reach T3's MCP endpoint on the server's own loopback address. The
  // relay listens on that address and port inside the sandbox and connects
  // back. A wildcard bind is announced as 127.0.0.1; other addresses are
  // reachable from the sandbox without help.
  const mcpReverse = (() => {
    if (!NetAddress.isInetAddress(httpServer.address)) return null;
    const host = NetAddress.isUnspecified(httpServer.address.address)
      ? "127.0.0.1"
      : NetAddress.formatIp(httpServer.address.address);
    if (!host.startsWith("127.") && host !== "::1") return null;
    return { host, port: httpServer.address.port };
  })();

  /**
   * The SSH agent git uses inside sandboxes. With `T3CODE_SANDBOX_SSH_KEYS`
   * (key files separated by `:`) T3 runs its own agent holding only those
   * keys; otherwise the host's `SSH_AUTH_SOCK` is forwarded. Either way the
   * private keys stay on the host: the sandbox only asks the agent to sign.
   */
  const sshKeys = (hostEnv.T3CODE_SANDBOX_SSH_KEYS ?? "")
    .split(":")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((value) => expandHomePath(value, NodeOS.homedir()));
  const sshAgent = yield* Effect.gen(function* () {
    if (sshKeys.length === 0) {
      const socket = hostEnv.SSH_AUTH_SOCK;
      return socket !== undefined && NodeFS.existsSync(socket) ? socket : null;
    }
    yield* fileSystem.makeDirectory(sandboxDir, { recursive: true }).pipe(Effect.ignore);
    const socket = path.join(sandboxDir, "ssh-agent.sock");
    yield* fileSystem.remove(socket).pipe(Effect.ignore);
    const agent = NodeChildProcess.spawn("ssh-agent", ["-D", "-a", socket], {
      env: hostEnv,
      stdio: "ignore",
    });
    agent.on("error", () => {});
    yield* Effect.addFinalizer(() => Effect.sync(() => agent.kill("SIGTERM")));
    const added = yield* processRunner
      .run({
        command: "ssh-add",
        args: ["-q", ...sshKeys],
        env: { ...hostEnv, SSH_AUTH_SOCK: socket },
      })
      .pipe(
        Effect.retry({ times: 10, schedule: Schedule.spaced("100 millis") }),
        Effect.map((result) => result.code === 0),
        Effect.orElseSucceed(() => false),
      );
    if (!added) {
      yield* Effect.logWarning(
        "Could not load sandbox SSH keys; git over SSH will fail in sandboxes",
        {
          keys: sshKeys,
        },
      );
    }
    return socket;
  });

  /**
   * Git settings for commands in a sandbox. Host git config often points at
   * host-only programs (a Nix store wrapper, a password manager signer), so
   * SSH goes through the forwarded agent, the identity comes from the host's
   * config for this workspace, and SSH commit signing uses the agent when its
   * key is one T3 loaded. Otherwise signing is turned off rather than failing
   * every commit.
   */
  const gitEnvFor = Effect.fn("SandboxService.gitEnvFor")(function* (workspacePath: string) {
    const gitConfig = (key: string) =>
      processRunner
        .run({ command: "git", args: ["config", "--get", key], cwd: workspacePath, env: hostEnv })
        .pipe(
          Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
          Effect.orElseSucceed(() => ""),
        );
    const env: Record<string, string> = {};
    const config: Array<readonly [string, string]> = [["safe.directory", "*"]];
    const name = yield* gitConfig("user.name");
    const email = yield* gitConfig("user.email");
    if (name) env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = name;
    if (email) env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = email;
    if (sshAgent !== null) {
      env.SSH_AUTH_SOCK = GUEST_SSH_AGENT;
      env.GIT_SSH_COMMAND = `ssh -o IdentityAgent=${GUEST_SSH_AGENT} -o IdentitiesOnly=no -o StrictHostKeyChecking=accept-new`;
    }
    if ((yield* gitConfig("commit.gpgsign")) === "true") {
      const signingKey = expandHomePath(yield* gitConfig("user.signingkey"), NodeOS.homedir());
      const format = yield* gitConfig("gpg.format");
      const publicKey =
        format === "ssh" && sshKeys.includes(signingKey)
          ? yield* processRunner
              .run({ command: "ssh-keygen", args: ["-y", "-f", signingKey], env: hostEnv })
              .pipe(
                Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
                Effect.orElseSucceed(() => ""),
              )
          : "";
      if (publicKey) {
        config.push(["user.signingkey", `key::${publicKey}`], ["gpg.ssh.program", "ssh-keygen"]);
      } else {
        config.push(["commit.gpgsign", "false"], ["tag.gpgsign", "false"]);
      }
    }
    // Pagers from the Nix store exist only on the host; fall back to plain ones.
    const listed = yield* processRunner
      .run({ command: "git", args: ["config", "--list", "-z"], cwd: workspacePath, env: hostEnv })
      .pipe(
        Effect.map((result) => (result.code === 0 ? result.stdout : "")),
        Effect.orElseSucceed(() => ""),
      );
    for (const entry of listed.split("\0")) {
      const [key = "", value = ""] = entry.split("\n", 2);
      if (!value.includes("/nix/store/")) continue;
      if (key === "core.pager" || key.startsWith("pager.")) config.push([key, "less -FRX"]);
      else if (key === "interactive.difffilter") config.push([key, "cat"]);
    }
    env.GIT_CONFIG_COUNT = String(config.length);
    config.forEach(([key, value], index) => {
      env[`GIT_CONFIG_KEY_${index}`] = key;
      env[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    return env;
  });
  const gitEnvs = new Map<string, Readonly<Record<string, string>>>();

  /** Authenticates this server to exec servers; kept so they survive a T3 restart. */
  const execTokenPath = path.join(sandboxDir, "exec-token");
  const savedExecToken = yield* fileSystem.readFileString(execTokenPath).pipe(
    Effect.map((token) => token.trim()),
    Effect.orElseSucceed(() => ""),
  );
  const execToken =
    savedExecToken.length >= 32 ? savedExecToken : NodeCrypto.randomBytes(32).toString("hex");
  if (execToken !== savedExecToken) {
    yield* fileSystem.makeDirectory(sandboxDir, { recursive: true }).pipe(Effect.ignore);
    yield* fileSystem
      .writeFileString(execTokenPath, execToken, { mode: 0o600 })
      .pipe(Effect.ignore);
  }

  /** A free loopback port: `preferred` or the next free one after it. msb does not fail on a busy port. */
  const freeHostPort = (preferred: number) =>
    Effect.gen(function* () {
      for (let port = preferred; port < preferred + 50; port += 1) {
        const free = yield* Effect.callback<boolean>((resume) => {
          const server = NodeNet.createServer();
          server.once("error", () => resume(Effect.succeed(false)));
          server.listen(port, "127.0.0.1", () => server.close(() => resume(Effect.succeed(true))));
        });
        if (free) return port;
      }
      return preferred;
    });

  const summarize = (record: SandboxRecord): SandboxSummary => ({
    workspacePath: record.workspacePath,
    threadIds: [...record.threadIds].map((threadId) => ThreadId.make(threadId)),
    containerName: record.containerName,
    backend: record.backend,
    image: record.image || "building",
    status: record.status,
    ports: record.tunnel?.ports ?? [],
    error: record.error,
  });
  const publish = () => PubSub.publishUnsafe(changes, undefined);
  /** Tells session owners that the threads here lost their sandbox processes. */
  const announceStopped = (record: SandboxRecord) =>
    PubSub.publishUnsafe(stoppedThreads, {
      workspacePath: record.workspacePath,
      threadIds: [...record.threadIds],
      processesStopped: true,
    });
  const announceMoved = (record: SandboxRecord, threadId: string) =>
    PubSub.publishUnsafe(stoppedThreads, {
      workspacePath: record.workspacePath,
      threadIds: [threadId],
      processesStopped: false,
    });
  const setStatus = (record: SandboxRecord, status: SandboxStatus, error: string | null = null) => {
    record.status = status;
    record.error = error;
    publish();
  };

  const toEntry = (record: SandboxRecord): RegistryEntry => ({
    workspacePath: record.workspacePath,
    ...(record.threadsUnknown ? {} : { threadIds: [...record.threadIds] }),
    containerName: record.containerName,
    backend: record.backend,
    image: record.image,
    versions: record.versions,
    mounts: record.mounts,
  });

  /** Saves the list. Writes are serialized so an older snapshot never lands last. */
  const persist = registryLock.withPermits(1)(
    Effect.gen(function* () {
      const contents = yield* encodeRegistry({
        version: 1,
        ...(unverified ? { unverified: true } : {}),
        sandboxes: [...records.values()].map(toEntry),
      });
      yield* writeFileStringAtomically({ filePath: registryPath, contents });
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(fail("create", registryPath, "Could not save the sandbox list.")),
    ),
  );
  const persistOrLog = persist.pipe(
    Effect.catchCause((cause) => Effect.logError("Failed to save the sandbox list", { cause })),
  );

  /** Per-sandbox host folder for exec env files, mounted at its own path. */
  const controlDir = (containerName: string) => path.join(sandboxDir, containerName);

  /** Folders and files mounted at their own path. Only paths that exist are mounted. */
  const mountsFor = Effect.fn("SandboxService.mountsFor")(function* (
    containerName: string,
    workspacePath: string,
    gitCommonDir: string | null,
    projectRoot: string,
    providers: ReadonlyArray<ServerProvider>,
    homes: ReadonlyArray<string>,
  ) {
    const providerHomes = providers
      .filter((provider) => Object.values(SANDBOX_DRIVERS).some((d) => d === provider.driver))
      .flatMap((provider) =>
        provider.runtimePaths === undefined
          ? []
          : [provider.runtimePaths.homePath, provider.runtimePaths.shadowHomePath ?? ""],
      )
      .filter((providerHome) => providerHome.length > 0);
    const control = controlDir(containerName);
    yield* fileSystem.makeDirectory(control, { recursive: true }).pipe(Effect.ignore);
    yield* fileSystem.chmod(control, 0o700).pipe(Effect.ignore);
    const candidates: ReadonlyArray<SandboxMount> = [
      { path: workspacePath, readOnly: false },
      ...(gitCommonDir === null ? [] : [{ path: gitCommonDir, readOnly: false }]),
      { path: control, readOnly: false },
      { path: hostEnv.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), readOnly: false },
      { path: hostEnv.CODEX_HOME ?? path.join(home, ".codex"), readOnly: false },
      ...[...providerHomes, ...homes].map((providerHome) => ({
        path: providerHome,
        readOnly: false,
      })),
      { path: path.join(home, ".gitconfig"), readOnly: true, file: true },
      { path: path.join(home, ".config", "git"), readOnly: true },
      // Claude reads pasted images from T3's attachment folder.
      { path: serverConfig.attachmentsDir, readOnly: true },
      // Setup scripts copy or link files such as .env from the checkout. A
      // checkout that holds the home folder would hide the sandbox's own home.
      ...(containsPath(projectRoot, home, path.sep) ? [] : [{ path: projectRoot, readOnly: true }]),
    ];
    const mounts: Array<SandboxMount> = [];
    for (const mount of candidates) {
      if (!isMountablePath(mount.path)) continue;
      // A writable mount already covers anything inside it; a read-only one
      // covers only read-only paths, so the workspace and git dir stay writable.
      const covered = mounts.some(
        (existing) =>
          containsPath(existing.path, mount.path, path.sep) &&
          (!existing.readOnly || mount.readOnly),
      );
      if (covered) continue;
      if (yield* fileSystem.exists(mount.path).pipe(Effect.orElseSucceed(() => false))) {
        mounts.push(mount);
      }
    }
    return mounts;
  });

  /**
   * Files the sandbox needs that cannot be mounted: config files a mounted
   * folder links to outside every mount (home-manager points them into the
   * Nix store, which a microVM cannot share), the user's SSH config and
   * known hosts (never the folder, which may hold private keys), and
   * `~/.claude.json`, which Claude replaces by rename and so cannot be a
   * mounted file. They are copied in at every start.
   */
  const filesToCopy = Effect.fn("SandboxService.filesToCopy")(function* (record: SandboxRecord) {
    const files = new Set<string>();
    const mounted = (target: string) =>
      record.mounts.some((mount) => containsPath(mount.path, target, path.sep));
    /** Adds what `link` points to when no mount covers it. */
    const addLinkTargets = Effect.fnUntraced(function* (link: string) {
      const target = yield* fileSystem.readLink(link).pipe(Effect.option);
      if (Option.isNone(target)) return;
      const resolved = yield* fileSystem.realPath(link).pipe(Effect.option);
      if (Option.isNone(resolved) || mounted(resolved.value)) return;
      files.add(resolved.value);
      // A link to a link (home-manager's out-of-store symlinks) is followed
      // by the guest one hop at a time, so the first hop must resolve too.
      const firstHop = path.resolve(path.dirname(link), target.value);
      if (firstHop !== resolved.value && !mounted(firstHop)) files.add(firstHop);
    });
    for (const mount of record.mounts) {
      if (mount.file || mount.path === record.workspacePath) continue;
      const entries = yield* fileSystem
        .readDirectory(mount.path)
        .pipe(Effect.orElseSucceed(() => []));
      for (const entry of entries) yield* addLinkTargets(path.join(mount.path, entry));
    }
    for (const file of [
      path.join(home, ".ssh", "config"),
      path.join(home, ".ssh", "known_hosts"),
      path.join(home, ".claude.json"),
    ]) {
      if (mounted(file)) continue;
      files.add(file);
      yield* addLinkTargets(file);
    }
    return [...files];
  });

  const copyIn = Effect.fn("SandboxService.copyIn")(function* (record: SandboxRecord) {
    const backend = backendOf(record);
    for (const file of yield* filesToCopy(record)) {
      const contents = yield* Effect.gen(function* () {
        const info = yield* fileSystem.stat(file);
        if (info.type === "Directory") {
          // A linked folder becomes a link to nothing; only its own link resolves.
          return Option.none<string>();
        }
        if (Number(info.size) > MAX_LINKED_FILE_BYTES) return Option.none<string>();
        return Option.some(yield* fileSystem.readFileString(file));
      }).pipe(Effect.orElseSucceed(() => Option.none<string>()));
      // A first hop that is itself a link is recreated as that link.
      const linkTarget = yield* fileSystem.readLink(file).pipe(Effect.option);
      const inHome = containsPath(home, file, path.sep);
      const script = Option.isSome(linkTarget)
        ? 'mkdir -p "$(dirname "$0")" && ln -sfn "$2" "$0"'
        : 'mkdir -p "$(dirname "$0")" && cat > "$0" && if [ -n "$1" ]; then chown "$1" "$0"; fi';
      if (Option.isNone(linkTarget) && Option.isNone(contents)) continue;
      yield* cliFor(backend.command)(
        "start",
        record.workspacePath,
        backend.execArgs({
          name: record.containerName,
          tty: false,
          root: true,
          argv: [
            "/bin/sh",
            "-c",
            script,
            file,
            inHome ? `${uid}:${gid}` : "",
            Option.getOrElse(linkTarget, () => ""),
          ],
        }),
        Option.isSome(contents) && Option.isNone(linkTarget) ? { stdin: contents.value } : {},
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not copy a file into the sandbox", {
            file,
            detail: error.detail,
          }),
        ),
      );
    }
  });

  /**
   * The host command that runs `argv` in the sandbox with streaming stdio:
   * the backend's own exec, or the exec server client when its exec cannot
   * stream (see `sandboxExecServer.ts`).
   */
  const streamingCommand = (
    record: SandboxRecord,
    argv: ReadonlyArray<string>,
    cwd?: string,
  ): { command: string; args: ReadonlyArray<string>; env: NodeJS.ProcessEnv } => {
    const backend = backendOf(record);
    if (!backend.execServer || record.execPort === null) {
      return {
        command: backend.command,
        args: backend.execArgs({ name: record.containerName, cwd, tty: false, argv }),
        env: hostEnv,
      };
    }
    return {
      command: process.execPath,
      args: ["-e", SANDBOX_EXEC_CLIENT_SOURCE],
      env: {
        ...hostEnv,
        // The desktop app runs the server under Electron.
        ELECTRON_RUN_AS_NODE: "1",
        T3_SANDBOX_EXEC: JSON.stringify({ port: record.execPort, token: execToken, argv, cwd }),
      },
    };
  };

  const spawnCli = (record: SandboxRecord, argv: ReadonlyArray<string>) => {
    const command = streamingCommand(record, argv);
    return NodeChildProcess.spawn(command.command, [...command.args], {
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  };

  /** Whether the sandbox's exec server answers with this server's token. */
  const execServerAlive = (record: SandboxRecord) => {
    const command = streamingCommand(record, ["true"]);
    return processRunner
      .run({ command: command.command, args: command.args, env: command.env, timeout: "3 seconds" })
      .pipe(
        Effect.map((result) => result.code === 0),
        Effect.orElseSucceed(() => false),
      );
  };

  /**
   * Starts the sandbox's exec server unless it already answers. It runs from
   * the control folder, so a new T3 version replaces it on the next start.
   */
  const ensureExecServer = Effect.fn("SandboxService.ensureExecServer")(function* (
    record: SandboxRecord,
  ) {
    const backend = backendOf(record);
    if (!backend.execServer) return;
    record.execPort ??= yield* backend.execHostPort(record.containerName);
    if (record.execPort === null) {
      return yield* fail(
        "start",
        record.workspacePath,
        "This sandbox has no exec port. Remove the sandbox; the next command creates a new one.",
      )();
    }
    if (yield* execServerAlive(record)) return;
    const control = controlDir(record.containerName);
    const script = path.join(control, "exec-server.js");
    const tokenFile = path.join(control, "exec-token");
    yield* fileSystem.writeFileString(script, SANDBOX_EXEC_SERVER_SOURCE).pipe(Effect.ignore);
    yield* fileSystem.writeFileString(tokenFile, execToken, { mode: 0o600 }).pipe(Effect.ignore);
    yield* cliFor(backend.command)(
      "start",
      record.workspacePath,
      backend.execArgs({
        name: record.containerName,
        tty: false,
        argv: [
          "/bin/sh",
          "-c",
          // A pid file, not pkill -f: the pattern would match this shell too.
          'p=/tmp/t3-exec-server.pid; [ -f $p ] && kill $(cat $p) 2>/dev/null; nohup node "$0" "$1" "$2" </dev/null >/dev/null 2>&1 & echo $! >$p',
          script,
          String(SANDBOX_EXEC_GUEST_PORT),
          tokenFile,
        ],
      }),
    ).pipe(Effect.mapError(fromBackend));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (yield* execServerAlive(record)) return;
      yield* Effect.sleep("250 millis");
    }
    return yield* fail("start", record.workspacePath, "The sandbox's exec server did not start.")();
  });

  const startTunnel = (record: SandboxRecord) => {
    const tunnel: SandboxTunnel = new SandboxTunnel({
      spawnRelay: () => spawnCli(record, ["node", "-e", SANDBOX_RELAY_SOURCE]),
      reversePorts:
        mcpReverse === null
          ? []
          : [{ host: mcpReverse.host, containerPort: mcpReverse.port, hostPort: mcpReverse.port }],
      reverseSockets:
        sshAgent === null
          ? []
          : [{ key: SSH_AGENT_KEY, containerPath: GUEST_SSH_AGENT, hostPath: sshAgent }],
      preferredHostPort: (containerPort) =>
        preferredSandboxHostPort(record.containerName, containerPort),
      onPortsChanged: publish,
      onHostActivity: () => wakeSoon(record),
      onExit: (detail) => {
        if (record.tunnel !== tunnel) return;
        record.tunnel = null;
        // The relay only exits by itself when the sandbox or its runtime went away.
        if (detail !== "closed") {
          setStatus(record, "stopped");
          announceStopped(record);
        } else {
          publish();
        }
      },
    });
    record.tunnel = tunnel;
  };

  const release = (record: SandboxRecord, target: string) => {
    const child = spawnCli(record, ["node", "-e", SANDBOX_KILL_SOURCE, target]);
    child.stdin.end();
    child.on("error", () => {});
    child.unref();
  };

  /**
   * Builds the image and creates the sandbox when either is missing, starts
   * a stopped sandbox, and starts the relay. Callers hold the record lock.
   */
  /** Thaws a sleeping sandbox. Every exec hangs on a frozen VM, so callers wake it first. */
  const wakeUnlocked = (record: SandboxRecord) =>
    Effect.gen(function* () {
      if (!record.sleeping) return;
      yield* (
        backendOf(record).wake?.(record.containerName, record.workspacePath) ?? Effect.void
      ).pipe(Effect.mapError(fromBackend));
      record.sleeping = false;
      record.lastUsedAt = Date.now();
      setStatus(record, "running");
    });

  /** Wakes a sleeping sandbox in the background, for callers that cannot wait (a preview tab, a keystroke). */
  const wakeSoon = (record: SandboxRecord) => {
    record.lastUsedAt = Date.now();
    if (!record.sleeping) return;
    runFork(
      record.lock
        .withPermits(1)(wakeUnlocked(record))
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Could not wake a sandbox", { cause })),
        ),
    );
  };

  const startUnlocked = (record: SandboxRecord, onOutput: (line: string) => void = () => {}) =>
    Effect.gen(function* () {
      // A lookup can hold a record that Remove deleted while it waited for the lock.
      if (records.get(record.workspacePath) !== record) return false;
      yield* wakeUnlocked(record);
      record.lastUsedAt = Date.now();
      if (record.status === "running" && record.tunnel?.alive === true) return true;
      setStatus(record, "starting");
      const backend = backendOf(record);
      const state = yield* backend.state(record.containerName);
      // The control folder is mounted, so it must exist before the VM boots,
      // and a restored state folder may have lost it.
      yield* fileSystem
        .makeDirectory(controlDir(record.containerName), { recursive: true })
        .pipe(
          Effect.andThen(fileSystem.chmod(controlDir(record.containerName), 0o700)),
          Effect.ignore,
        );
      if (state === "missing") {
        yield* backend.ensureAvailable(record.workspacePath);
        record.image = yield* backend.ensureImage(
          { uid, gid, home, versions: record.versions },
          onOutput,
        );
        yield* persistOrLog;
        onOutput(`Starting sandbox ${record.containerName}`);
        yield* backend.create({
          name: record.containerName,
          workspacePath: record.workspacePath,
          image: record.image,
          versions: record.versions,
          mounts: record.mounts,
          uid,
          gid,
          home,
          ipv6Loopback: mcpReverse?.host === "::1",
          threadId: record.threadIds.values().next().value,
          environmentId,
          ...(backend.execServer
            ? {
                execHostPort: (record.execPort = yield* freeHostPort(
                  preferredSandboxHostPort(record.containerName, SANDBOX_EXEC_GUEST_PORT),
                )),
              }
            : {}),
        });
      } else if (state !== "running") {
        yield* backend.start(record.containerName, record.workspacePath);
      }
      if (state !== "running") yield* copyIn(record);
      yield* ensureExecServer(record);
      if (!record.reaped) {
        // Commands an earlier server process started outlive it in the
        // sandbox; stop them like the host stops orphaned terminals.
        yield* cliFor(backend.command)(
          "start",
          record.workspacePath,
          backend.execArgs({
            name: record.containerName,
            tty: false,
            argv: ["node", "-e", SANDBOX_KILL_SOURCE, "--all"],
          }),
        ).pipe(Effect.ignore);
        record.reaped = true;
      }
      if (!gitEnvs.has(record.workspacePath)) {
        gitEnvs.set(record.workspacePath, yield* gitEnvFor(record.workspacePath));
      }
      if (record.tunnel?.alive !== true) startTunnel(record);
      record.lastUsedAt = Date.now();
      setStatus(record, "running");
      return true;
    }).pipe(
      Effect.mapError((error) => (Schema.is(SandboxError)(error) ? error : fromBackend(error))),
      Effect.tapError((error) => Effect.sync(() => setStatus(record, "error", error.detail))),
    );

  /** The sandbox a thread was attached to. */
  const threadRecord = (threadId: string) => {
    for (const record of records.values()) {
      if (record.threadIds.has(threadId)) return record;
    }
    return undefined;
  };

  /** A sandbox adopted without its thread list that owns `cwd`. */
  const unknownThreadsRecordFor = (cwd: string) => {
    for (const record of records.values()) {
      if (record.threadsUnknown && containsPath(record.workspacePath, cwd, path.sep)) return record;
    }
    return undefined;
  };

  /** True when `cwd` might be sandboxed but the list is unverified. Retries the rebuild once. */
  const unknownSandbox = (cwd: string) =>
    Effect.gen(function* () {
      if (!unverified || !containsPath(serverConfig.worktreesDir, cwd, path.sep)) return false;
      yield* reconcileOnce;
      if (!unverified) return false;
      for (const record of records.values()) {
        if (containsPath(record.workspacePath, cwd, path.sep)) return false;
      }
      return true;
    });

  const makeExecTarget = (record: SandboxRecord): SandboxExecTarget => ({
    workspacePath: record.workspacePath,
    containerName: record.containerName,
    command: (input) => {
      for (const name of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]) {
        const value = input.env[name];
        if (value === undefined || value === hostEnv[name]) continue;
        if (!record.mounts.some((mount) => containsPath(mount.path, value, path.sep))) {
          throw fail(
            "exec",
            record.workspacePath,
            `This provider uses ${name}=${value}, which this sandbox does not mount. Start a new sandbox after changing a provider's home folder.`,
          )();
        }
      }
      const execId = NodeCrypto.randomUUID();
      const envFile = path.join(controlDir(record.containerName), `${execId}.env`);
      const env: Record<string, string> = { ...gitEnvs.get(record.workspacePath) };
      for (const name of sandboxEnvNames(input.env, hostEnv)) env[name] = input.env[name]!;
      // The host pty sets TERM on the backend's exec, which does not pass it on.
      if (input.tty && (env.TERM === undefined || env.TERM === "dumb")) env.TERM = "xterm-256color";
      NodeFS.writeFileSync(envFile, renderSandboxEnvFile(env), { mode: 0o600 });
      record.activeExecs += 1;
      record.lastUsedAt = Date.now();
      let released = false;
      const backend = backendOf(record);
      const argv = sandboxExecLauncherArgs(execId, envFile, input.command, input.args);
      // A tty exec streams on every backend; piped stdio may need the exec server.
      const command = input.tty
        ? {
            command: backend.command,
            args: backend.execArgs({ name: record.containerName, cwd: input.cwd, tty: true, argv }),
            env: hostEnv,
          }
        : streamingCommand(record, argv, input.cwd);
      return {
        ...command,
        release: () => {
          if (released) return;
          released = true;
          record.activeExecs -= 1;
          record.lastUsedAt = Date.now();
          NodeFS.rm(envFile, { force: true }, () => {});
          release(record, execId);
        },
      };
    },
  });

  /**
   * The marker file for a workspace: `<git admin dir>/t3code-sandbox.json`.
   * The admin dir is `.git` in a checkout, or what the `.git` file of a
   * linked worktree points to. Folders outside git have no marker.
   */
  const markerPath = (workspacePath: string) =>
    Effect.gen(function* () {
      const dotGit = path.join(workspacePath, ".git");
      const info = yield* fileSystem.stat(dotGit).pipe(Effect.option);
      if (Option.isNone(info)) return undefined;
      if (info.value.type === "Directory") return path.join(dotGit, MARKER_FILE);
      const gitDir = yield* fileSystem.readFileString(dotGit).pipe(
        Effect.map((text) => /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()),
        Effect.orElseSucceed(() => undefined),
      );
      return gitDir === undefined
        ? undefined
        : path.join(path.resolve(workspacePath, gitDir), MARKER_FILE);
    });

  /** Saves the record next to its workspace's git data, so a lost list can be rebuilt. */
  const writeMarker = (record: SandboxRecord) =>
    Effect.gen(function* () {
      const marker = yield* markerPath(record.workspacePath);
      if (marker === undefined) return;
      const contents = yield* encodeMarker(toEntry(record));
      yield* writeFileStringAtomically({ filePath: marker, contents });
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        fail("create", record.workspacePath, "Could not mark the workspace as sandboxed."),
      ),
    );

  /**
   * Rebuilds a sandbox from the marker in its workspace when the saved list
   * lost it, so a lost list never lets sandboxed work start on the host.
   */
  const recordFromMarker = (cwd: string) =>
    Effect.gen(function* () {
      // Every ancestor is checked, so a submodule or nested repository inside
      // a sandboxed workspace still finds the workspace's marker.
      let dir = cwd;
      while (true) {
        const existing = records.get(dir);
        if (existing !== undefined) return existing;
        const marker = yield* markerPath(dir);
        const entry =
          marker === undefined
            ? undefined
            : yield* fileSystem.readFileString(marker).pipe(
                Effect.flatMap(decodeMarker),
                Effect.orElseSucceed(() => undefined),
              );
        if (entry !== undefined && entry.workspacePath === dir) {
          addLoadedRecord(entry);
          publish();
          yield* persistOrLog;
          return records.get(entry.workspacePath);
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
    });

  /**
   * The sandbox the thread runs in: the one it was attached to, or one whose
   * thread list was lost and that owns `cwd`. A thread attached elsewhere
   * cannot run outside its sandbox's workspace.
   */
  const lookup = (ref: SandboxThreadRef) =>
    Effect.gen(function* () {
      const attached = threadRecord(ref.threadId);
      if (attached !== undefined) {
        if (!containsPath(attached.workspacePath, ref.cwd, path.sep)) {
          return yield* fail(
            "exec",
            attached.workspacePath,
            `This thread runs in a sandbox for ${attached.workspacePath}, which cannot reach ${ref.cwd}. Take the thread out of its sandbox to work there.`,
          )();
        }
        return attached;
      }
      const unknown = unknownThreadsRecordFor(ref.cwd);
      if (unknown !== undefined) return unknown;
      const fromMarker = yield* recordFromMarker(ref.cwd);
      return fromMarker !== undefined &&
        (fromMarker.threadsUnknown || fromMarker.threadIds.has(ref.threadId))
        ? fromMarker
        : undefined;
    });

  /** Deletes a sandbox and forgets it. Callers hold the record lock. */
  const removeUnlocked = (record: SandboxRecord) =>
    Effect.gen(function* () {
      yield* wakeUnlocked(record);
      record.tunnel?.close();
      record.tunnel = null;
      // A failed first start can leave no sandbox to delete.
      yield* backendOf(record)
        .remove(record.containerName, record.workspacePath)
        .pipe(Effect.mapError(fromBackend));
      records.delete(record.workspacePath);
      gitEnvs.delete(record.workspacePath);
      publish();
      announceStopped(record);
      yield* persistOrLog;
      const marker = yield* markerPath(record.workspacePath);
      if (marker !== undefined) yield* fileSystem.remove(marker).pipe(Effect.ignore);
      yield* fileSystem
        .remove(controlDir(record.containerName), { recursive: true })
        .pipe(Effect.ignore);
    });

  /**
   * Adds folders the sandbox does not mount yet. Mounts are fixed when a
   * sandbox is created, so it is deleted and created again with them: the
   * workspace and config folders are on the host, only the machine's own
   * state (installed packages, services) starts over. Callers hold the lock.
   */
  const addMountsUnlocked = (record: SandboxRecord, folders: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const missing: Array<string> = [];
      for (const folder of folders) {
        if (!isMountablePath(folder)) continue;
        if (record.mounts.some((mount) => containsPath(mount.path, folder, path.sep))) continue;
        if (missing.some((other) => containsPath(other, folder, path.sep))) continue;
        if (!(yield* fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => false)))) continue;
        missing.push(folder);
      }
      if (missing.length === 0) return;
      if (record.activeExecs > 0) {
        return yield* fail(
          "exec",
          record.workspacePath,
          `This thread needs ${missing.join(", ")}, which its sandbox does not mount, and the sandbox is still running other commands. Stop the sandbox, then send the message again.`,
        )();
      }
      yield* wakeUnlocked(record);
      record.tunnel?.close();
      record.tunnel = null;
      yield* backendOf(record)
        .remove(record.containerName, record.workspacePath)
        .pipe(Effect.mapError(fromBackend));
      record.mounts = [
        ...record.mounts,
        ...missing.map((folder) => ({ path: folder, readOnly: false })),
      ];
      record.execPort = null;
      record.reaped = true;
      setStatus(record, "stopped");
      announceStopped(record);
      yield* persistOrLog;
      yield* writeMarker(record);
      yield* Effect.logInfo("Recreating a sandbox to mount more folders", {
        workspacePath: record.workspacePath,
        folders: missing,
      });
    });

  const attach: SandboxService["Service"]["attach"] = Effect.fn("SandboxService.attach")(
    function* (input) {
      yield* Deferred.await(ready);
      if (!supported) {
        return yield* fail(
          "create",
          input.workspacePath,
          "Sandboxes run on Linux and macOS hosts.",
        )();
      }
      const current = threadRecord(input.threadId);
      if (current?.workspacePath === input.workspacePath) return;
      if (current !== undefined) yield* detach(input.threadId);
      const existing = records.get(input.workspacePath);
      if (existing !== undefined) {
        existing.threadIds.add(input.threadId);
        publish();
        yield* persist.pipe(
          Effect.andThen(writeMarker(existing)),
          Effect.tapError(() =>
            Effect.sync(() => {
              existing.threadIds.delete(input.threadId);
              publish();
            }).pipe(Effect.andThen(persistOrLog)),
          ),
        );
        // Sessions the thread opened on the host must not be reused.
        announceMoved(existing, input.threadId);
        return;
      }
      if (!isMountablePath(input.workspacePath)) {
        return yield* fail(
          "create",
          input.workspacePath,
          "Sandboxes cannot mount a path that contains a comma or a colon.",
        )();
      }
      if (containsPath(input.workspacePath, home, path.sep)) {
        return yield* fail(
          "create",
          input.workspacePath,
          "A sandbox cannot mount a folder that contains your home folder.",
        )();
      }
      // A folder outside git has no git dir to mount or marker to keep.
      const gitCommonDir = yield* processRunner
        .run({
          command: "git",
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          cwd: input.workspacePath,
          env: hostEnv,
        })
        .pipe(
          Effect.map((result) =>
            result.code === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null,
          ),
          Effect.orElseSucceed(() => null),
        );
      const containerName = sandboxContainerName(input.workspacePath);
      const record: SandboxRecord = {
        workspacePath: input.workspacePath,
        threadIds: new Set([input.threadId]),
        threadsUnknown: false,
        containerName,
        backend: defaultBackend,
        versions: {
          claude: providerVersion(input.providers, SANDBOX_DRIVERS.claude),
          codex: providerVersion(input.providers, SANDBOX_DRIVERS.codex),
        },
        mounts: yield* mountsFor(
          containerName,
          input.workspacePath,
          gitCommonDir,
          input.projectRoot,
          input.providers,
          input.homes,
        ),
        image: "",
        status: "starting",
        error: null,
        tunnel: null,
        reaped: true,
        activeExecs: 0,
        lastUsedAt: Date.now(),
        sleeping: false,
        turns: new Set(),
        retired: new Set(),
        execPort: null,
        lock: Semaphore.makeUnsafe(1),
      };
      // Saved before the slow start, so terminals opened during the build wait
      // for the sandbox instead of starting on the host. A failed start leaves
      // the record in place for the next attempt.
      records.set(record.workspacePath, record);
      publish();
      yield* persist.pipe(
        Effect.andThen(writeMarker(record)),
        Effect.tapError(() =>
          Effect.sync(() => {
            records.delete(record.workspacePath);
            publish();
          }).pipe(Effect.andThen(persistOrLog)),
        ),
      );
      announceMoved(record, input.threadId);
    },
  );

  const start: SandboxService["Service"]["start"] = Effect.fn("SandboxService.start")(
    function* (input) {
      const record = threadRecord(input.threadId);
      if (record === undefined) {
        return yield* fail("start", "", "This thread has no sandbox.")();
      }
      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      const onOutput = (line: string) => {
        if (input.onOutput) runFork(input.onOutput(line));
      };
      yield* record.lock.withPermits(1)(startUnlocked(record, onOutput));
      return summarize(record);
    },
  );

  const execTarget: SandboxService["Service"]["execTarget"] = (ref) =>
    Effect.gen(function* () {
      yield* Deferred.await(ready);
      if (yield* unknownSandbox(ref.cwd)) {
        return yield* fail(
          "start",
          ref.cwd,
          "T3 could not read its sandbox list and the sandbox runtime is not reachable, so it cannot tell whether this thread runs in a sandbox. Start the runtime and try again.",
        )();
      }
      const record = yield* lookup(ref);
      if (record === undefined) return Option.none();
      const started = yield* record.lock.withPermits(1)(
        addMountsUnlocked(record, ref.homes ?? []).pipe(Effect.andThen(startUnlocked(record))),
      );
      return started ? Option.some(makeExecTarget(record)) : Option.none();
    });

  /** Stops a sandbox. Callers hold the record lock. */
  const stopUnlocked = (record: SandboxRecord) =>
    Effect.gen(function* () {
      // A frozen VM cannot shut down.
      yield* wakeUnlocked(record);
      record.tunnel?.close();
      record.tunnel = null;
      yield* backendOf(record)
        .stop(record.containerName, record.workspacePath)
        .pipe(Effect.mapError(fromBackend));
      // The sandbox's processes are gone, so nothing is left to reap.
      record.reaped = true;
      record.activeExecs = 0;
      setStatus(record, "stopped");
      announceStopped(record);
    });

  /** Puts an idle sandbox to sleep, or stops it on backends that cannot sleep. Callers hold the lock. */
  const sleepUnlocked = (record: SandboxRecord) =>
    Effect.gen(function* () {
      const backend = backendOf(record);
      if (backend.sleep === undefined) return yield* stopUnlocked(record);
      yield* backend
        .sleep(record.containerName, record.workspacePath)
        .pipe(Effect.mapError(fromBackend));
      record.sleeping = true;
      setStatus(record, "sleeping");
    });

  /** The sandbox a thread works in, without any I/O. */
  const recordFor = (ref: SandboxThreadRef) =>
    threadRecord(ref.threadId) ?? unknownThreadsRecordFor(ref.cwd);

  const turnStarted: SandboxService["Service"]["turnStarted"] = (input) =>
    Effect.gen(function* () {
      const record = recordFor(input);
      if (record === undefined) return;
      record.turns.add(input.key);
      record.retired.delete(input.threadId);
      yield* record.lock.withPermits(1)(wakeUnlocked(record));
    });

  const turnEnded: SandboxService["Service"]["turnEnded"] = (key) => {
    for (const record of records.values()) {
      if (record.turns.delete(key)) record.lastUsedAt = Date.now();
    }
  };

  const touch: SandboxService["Service"]["touch"] = (ref) => {
    const record = recordFor(ref);
    if (record !== undefined) wakeSoon(record);
  };

  const retire: SandboxService["Service"]["retire"] = (threadId) =>
    Effect.gen(function* () {
      const record = threadRecord(threadId);
      if (record === undefined) return;
      record.retired.add(threadId);
      if (record.threadsUnknown || [...record.threadIds].some((id) => !record.retired.has(id))) {
        return;
      }
      // The thread stays sandboxed: its next command creates a fresh VM.
      yield* record.lock.withPermits(1)(
        Effect.gen(function* () {
          if (record.turns.size > 0 || records.get(record.workspacePath) !== record) return;
          yield* wakeUnlocked(record);
          record.tunnel?.close();
          record.tunnel = null;
          yield* backendOf(record)
            .remove(record.containerName, record.workspacePath)
            .pipe(Effect.mapError(fromBackend));
          record.reaped = true;
          record.activeExecs = 0;
          setStatus(record, "stopped");
          announceStopped(record);
        }),
      );
    });

  const unretire: SandboxService["Service"]["unretire"] = (threadId) => {
    threadRecord(threadId)?.retired.delete(threadId);
  };

  const stop: SandboxService["Service"]["stop"] = (threadId) =>
    Effect.gen(function* () {
      const record = threadRecord(threadId);
      if (record === undefined) return;
      yield* record.lock.withPermits(1)(stopUnlocked(record));
    });

  function detach(threadId: string): Effect.Effect<void, SandboxError> {
    return Effect.gen(function* () {
      const record = threadRecord(threadId);
      if (record === undefined) return;
      yield* record.lock.withPermits(1)(
        Effect.gen(function* () {
          if (record.threadIds.size > 1) {
            record.threadIds.delete(threadId);
            publish();
            announceMoved(record, threadId);
            yield* persistOrLog;
            yield* writeMarker(record).pipe(Effect.ignore);
            return;
          }
          yield* removeUnlocked(record);
        }),
      );
    });
  }

  const remove: SandboxService["Service"]["remove"] = (workspacePath) =>
    Effect.gen(function* () {
      const record = records.get(workspacePath);
      if (record === undefined) return;
      yield* record.lock.withPermits(1)(removeUnlocked(record));
    });

  const list = Effect.sync(() => [...records.values()].map(summarize));

  /** One-slot sliding mailbox: a slow client only ever holds the newest list. */
  const stream: SandboxService["Service"]["stream"] = Stream.callback<SandboxListStreamEvent>(
    (mailbox) =>
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        Queue.offerUnsafe(mailbox, { sandboxes: yield* list });
        yield* Stream.fromSubscription(subscription).pipe(
          Stream.runForEach(() =>
            Effect.map(list, (sandboxes) => Queue.offerUnsafe(mailbox, { sandboxes })),
          ),
          Effect.forkScoped,
        );
      }),
    { bufferSize: 1, strategy: "sliding" },
  );

  const forwardedPorts: SandboxService["Service"]["forwardedPorts"] = () =>
    [...records.values()].flatMap((record) =>
      (record.tunnel?.ports ?? []).map((port) => ({
        workspacePath: record.workspacePath,
        ...port,
      })),
    );

  const worktreeExists = (workspacePath: string) =>
    fileSystem.exists(workspacePath).pipe(Effect.orElseSucceed(() => false));

  const addLoadedRecord = (entry: RegistryEntry) =>
    records.set(entry.workspacePath, {
      ...entry,
      mounts: [...entry.mounts],
      threadIds: new Set(entry.threadIds ?? []),
      threadsUnknown: entry.threadIds === undefined,
      backend: entry.backend ?? "docker",
      status: "stopped",
      error: null,
      tunnel: null,
      reaped: false,
      activeExecs: 0,
      lastUsedAt: Date.now(),
      sleeping: false,
      turns: new Set(),
      retired: new Set(),
      execPort: null,
      lock: Semaphore.makeUnsafe(1),
    });

  // Load the saved list. A missing file means no sandboxes yet; an unreadable
  // one is logged, and the labeled sandboxes below rebuild what they can.
  const saved = yield* fileSystem.readFileString(registryPath).pipe(
    Effect.flatMap(decodeRegistry),
    Effect.map((registry) => {
      if (registry.unverified === true) unverified = true;
      return registry.sandboxes;
    }),
    Effect.catchCause((cause) =>
      fileSystem.exists(registryPath).pipe(
        Effect.orElseSucceed(() => true),
        Effect.flatMap((exists) =>
          exists
            ? Effect.logError("Could not read the sandbox list", { registryPath, cause }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    unverified = true;
                  }),
                ),
              )
            : Effect.void,
        ),
        Effect.as([]),
      ),
    ),
  );
  for (const entry of saved) addLoadedRecord(entry);

  /**
   * Adopts labeled sandboxes the saved list does not know (their threads are
   * unknown, so any thread in their workspace runs in them), drops sandboxes
   * whose workspace is gone or that no thread uses, and reconnects sandboxes that are still running
   * so their ports show up after a restart. Backends that are not installed
   * are skipped; their sandboxes stay registered and fail closed.
   */
  const reconcile = Effect.gen(function* () {
    const running = new Set<string>();
    let changed = false;
    let listed = false;
    for (const backend of Object.values(backends)) {
      const owned = yield* backend.listOwned.pipe(Effect.option);
      if (Option.isNone(owned)) continue;
      listed = true;
      for (const instance of owned.value) {
        if (instance.running) running.add(instance.name);
        if (records.has(instance.workspacePath)) continue;
        addLoadedRecord({
          workspacePath: instance.workspacePath,
          containerName: instance.name,
          backend: backend.kind,
          image: instance.image,
          versions: instance.versions,
          mounts: instance.mounts,
        });
        changed = true;
      }
    }
    if (!listed) {
      return yield* fail("start", registryPath, "No sandbox runtime could list its sandboxes.")();
    }
    for (const record of [...records.values()]) {
      const used = record.threadsUnknown || record.threadIds.size > 0;
      if (used && (yield* worktreeExists(record.workspacePath))) continue;
      records.delete(record.workspacePath);
      changed = true;
      yield* (
        backendOf(record).wake?.(record.containerName, record.workspacePath) ?? Effect.void
      ).pipe(Effect.ignore);
      yield* backendOf(record)
        .remove(record.containerName, record.workspacePath)
        .pipe(Effect.ignore);
    }
    if (unverified) changed = true;
    unverified = false;
    if (changed) {
      publish();
      yield* persistOrLog;
    }
    return [...records.values()].filter((record) => running.has(record.containerName));
  });

  const reconcileOnce = reconcile.pipe(
    Effect.timeout("15 seconds"),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not check sandboxes", { cause }).pipe(Effect.as([])),
    ),
  );

  yield* reconcileOnce.pipe(
    Effect.tap(() => Deferred.succeed(ready, undefined)),
    // Sandboxes an earlier server process left running (it crashed, or
    // could not stop them) stop now; the next command starts them again.
    Effect.flatMap((runningRecords) =>
      Effect.forEach(
        runningRecords,
        (record) =>
          record.lock
            .withPermits(1)(
              Effect.gen(function* () {
                // It may have been put to sleep before the crash.
                record.sleeping = true;
                yield* stopUnlocked(record);
              }),
            )
            .pipe(Effect.ignore),
        { discard: true },
      ),
    ),
    Effect.ensuring(Deferred.succeed(ready, undefined)),
    Effect.forkScoped,
  );

  // An idle sandbox sleeps so a machine running many of them only pays for
  // the busy ones: its free memory goes back to the host and it takes no
  // CPU, while its processes keep their state. Idle means no provider turn
  // runs in it and nothing used it (a command, a keystroke, relay bytes
  // such as a preview tab or git over SSH) within the window. Any of those
  // wakes it again.
  const idleMs = idleMinutes(hostEnv) * 60_000;
  if (idleMs > 0) {
    yield* Effect.gen(function* () {
      const now = Date.now();
      for (const record of records.values()) {
        if (record.status !== "running" || record.sleeping || record.turns.size > 0) continue;
        const lastActive = Math.max(record.lastUsedAt, record.tunnel?.lastActivityAt ?? 0);
        if (now - lastActive < idleMs) continue;
        yield* record.lock
          .withPermits(1)(
            // Recheck under the lock: a turn may have started meanwhile.
            record.turns.size > 0 || record.status !== "running" || record.sleeping
              ? Effect.void
              : sleepUnlocked(record).pipe(
                  Effect.tap(() =>
                    Effect.logInfo("An idle sandbox went to sleep", {
                      workspacePath: record.workspacePath,
                    }),
                  ),
                ),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not put an idle sandbox to sleep", { cause }),
            ),
          );
      }
    }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);
  }

  // Sandboxes live and die with the server, like child processes. A crash
  // that skips this is covered by the VM's own idle timeout.
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      [...records.values()].filter((record) => record.status !== "stopped"),
      (record) =>
        stopUnlocked(record).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not stop a sandbox on shutdown", { cause }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    ).pipe(
      Effect.timeout("20 seconds"),
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => {
          for (const record of records.values()) record.tunnel?.close();
        }),
      ),
    ),
  );

  return SandboxService.of({
    supported,
    backend: defaultBackend,
    attach,
    start,
    execTarget,
    turnStarted,
    turnEnded,
    touch,
    retire,
    unretire,
    // A thread whose sandbox cannot reach its folder counts as sandboxed, so
    // it fails closed in execTarget instead of running on the host.
    isSandboxed: (ref) =>
      Deferred.await(ready).pipe(
        Effect.andThen(unknownSandbox(ref.cwd)),
        Effect.flatMap((unknown) =>
          unknown
            ? Effect.succeed(true)
            : lookup(ref).pipe(
                Effect.map((record) => record !== undefined),
                Effect.orElseSucceed(() => true),
              ),
        ),
      ),
    workspaceOf: (threadId, cwd) =>
      Deferred.await(ready).pipe(
        Effect.map(
          () =>
            (threadRecord(threadId) ?? (cwd === null ? undefined : unknownThreadsRecordFor(cwd)))
              ?.workspacePath,
        ),
      ),
    stop,
    detach,
    remove,
    list,
    stream,
    forwardedPorts,
    stopped: Stream.fromPubSub(stoppedThreads),
  });
});

export const layer = Layer.effect(SandboxService, make);
