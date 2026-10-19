// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off - spawns the sandbox CLI for relays, sync exec plans, and env files; idle times are wall-clock.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import type {
  SandboxBackendKind,
  SandboxListStreamEvent,
  SandboxStatus,
  SandboxSummary,
  ServerProvider,
  ServerSettings,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
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
import { HttpServer } from "effect/unstable/http";
import * as NetAddress from "effect/unstable/net/NetAddress";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
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
  worktreePath: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Runs commands inside one sandbox. Plain functions, so sync spawn callbacks can use it. */
export interface SandboxExecTarget {
  readonly worktreePath: string;
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
  readonly worktreePath: string;
  readonly containerPort: number;
  readonly hostPort: number;
}

/**
 * Sandboxes for worktrees. A sandbox is one long-running container or
 * microVM (see `SandboxBackend`) that mounts its worktree (and the
 * repository's git dir) at the same path, plus the user's Claude and Codex
 * config folders. Agents, terminals, and setup scripts whose cwd is inside a
 * sandboxed worktree run in it through the backend's exec, so parallel
 * threads get separate ports, services, and machine state while T3 keeps
 * reading the worktree on the host.
 *
 * A worktree is registered as sandboxed before anything slow happens, and
 * stays registered when provisioning fails, so work there fails instead of
 * running on the host. The list is persisted, and sandboxes carry labels
 * that rebuild it if the file is lost.
 */
export class SandboxService extends Context.Service<
  SandboxService,
  {
    /** Whether this host can run sandboxes at all: Linux and macOS. */
    readonly supported: boolean;
    /** The runtime new sandboxes use. */
    readonly backend: SandboxBackendKind;
    /**
     * Marks a new worktree as sandboxed and saves it. Fast; call it before
     * anything can run in the worktree, then `start`. `providers` supplies
     * the Claude and Codex versions to install; their home folders, plus
     * `homes` (see `sandboxProviderHomes`), are mounted.
     */
    readonly register: (input: {
      readonly worktreePath: string;
      /** The project checkout, mounted read-only for setup scripts that copy or link from it. */
      readonly projectRoot: string;
      readonly providers: ReadonlyArray<ServerProvider>;
      readonly homes: ReadonlyArray<string>;
    }) => Effect.Effect<void, SandboxError>;
    /** Builds the image if needed, then creates and starts a registered sandbox. */
    readonly start: (input: {
      readonly worktreePath: string;
      readonly onOutput?: (line: string) => Effect.Effect<void>;
    }) => Effect.Effect<SandboxSummary, SandboxError>;
    /** The started sandbox that owns `cwd`, or none when `cwd` is not sandboxed. */
    readonly execTarget: (
      cwd: string,
    ) => Effect.Effect<Option.Option<SandboxExecTarget>, SandboxError>;
    /** Whether `cwd` is inside a sandboxed worktree. Does not start anything. */
    readonly isSandboxed: (cwd: string) => Effect.Effect<boolean>;
    /** Stops the sandbox. The next command in the worktree starts it again. */
    readonly stop: (worktreePath: string) => Effect.Effect<void, SandboxError>;
    /** Deletes the sandbox. Work in the worktree runs on the host afterwards. */
    readonly remove: (worktreePath: string) => Effect.Effect<void, SandboxError>;
    readonly list: Effect.Effect<ReadonlyArray<SandboxSummary>>;
    /** Emits the full list first, then after every change. */
    readonly stream: Stream.Stream<SandboxListStreamEvent>;
    /** Every forwarded sandbox port, for preview discovery. */
    readonly forwardedPorts: () => ReadonlyArray<SandboxForwardedPort>;
    /**
     * Worktrees whose sandbox stopped, was removed, or lost its relay. The
     * processes T3 ran there are gone, so sessions holding them are dead.
     */
    readonly stopped: Stream.Stream<string>;
  }
>()("t3/sandbox/SandboxService") {}

const Mount = Schema.Struct({
  path: Schema.String,
  readOnly: Schema.Boolean,
  file: Schema.optional(Schema.Boolean),
});

const RegistryEntry = Schema.Struct({
  worktreePath: Schema.String,
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
/** Kept in the worktree's own git admin folder, which `git worktree remove` deletes. */
const MARKER_FILE = "t3code-sandbox.json";

interface SandboxRecord {
  readonly worktreePath: string;
  readonly containerName: string;
  readonly backend: SandboxBackendKind;
  readonly versions: SandboxCliVersions;
  readonly mounts: ReadonlyArray<SandboxMount>;
  /** Empty until the first image build finishes. */
  image: string;
  status: SandboxStatus;
  error: string | null;
  tunnel: SandboxTunnel | null;
  /** Commands left running by an earlier server process were killed. */
  reaped: boolean;
  /** Commands started through `command` that have not been released. */
  activeExecs: number;
  /** When the last command started or ended, for idle stops. */
  lastUsedAt: number;
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
      homes.push(expandHomePath(value.trim()));
    }
  };
  add(settings.providers.codex.homePath);
  add(settings.providers.codex.shadowHomePath);
  add(settings.providers.claudeAgent.homePath);
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

/** Minutes without commands or relay traffic before a sandbox stops. 0 keeps them running. */
const idleMinutes = (env: NodeJS.ProcessEnv) => {
  const value = Number.parseInt(env.T3CODE_SANDBOX_IDLE_MINUTES ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : 15;
};

const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const serverConfig = yield* ServerConfig.ServerConfig;
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
  const stoppedWorktrees = yield* PubSub.unbounded<string>();
  const registryLock = yield* Semaphore.make(1);
  // Lookups wait until labeled sandboxes missing from the saved list are adopted.
  const ready = yield* Deferred.make<void>();
  // Set while an unreadable list has not been rebuilt yet. Then no T3
  // worktree can be shown to be unsandboxed, so lookups there fail.
  let unverified = false;

  const fail =
    (operation: SandboxError["operation"], worktreePath: string, detail: string) =>
    (cause?: unknown) =>
      new SandboxError({
        operation,
        worktreePath,
        detail,
        ...(cause === undefined ? {} : { cause }),
      });
  const fromBackend = (error: SandboxBackendError) =>
    new SandboxError({
      operation: error.operation,
      worktreePath: error.worktreePath,
      detail: error.detail,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });

  /** Runs a short backend CLI command and returns trimmed stdout, failing on a non-zero exit. */
  const cliFor =
    (command: string): SandboxCli =>
    (operation, worktreePath, args, options = {}) => {
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
            worktreePath,
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
                  worktreePath,
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
    .map(expandHomePath);
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
   * config for this worktree, and SSH commit signing uses the agent when its
   * key is one T3 loaded. Otherwise signing is turned off rather than failing
   * every commit.
   */
  const gitEnvFor = Effect.fn("SandboxService.gitEnvFor")(function* (worktreePath: string) {
    const gitConfig = (key: string) =>
      processRunner
        .run({ command: "git", args: ["config", "--get", key], cwd: worktreePath, env: hostEnv })
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
      const signingKey = expandHomePath(yield* gitConfig("user.signingkey"));
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
      .run({ command: "git", args: ["config", "--list", "-z"], cwd: worktreePath, env: hostEnv })
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
    worktreePath: record.worktreePath,
    containerName: record.containerName,
    backend: record.backend,
    image: record.image || "building",
    status: record.status,
    ports: record.tunnel?.ports ?? [],
    error: record.error,
  });
  const publish = () => PubSub.publishUnsafe(changes, undefined);
  const setStatus = (record: SandboxRecord, status: SandboxStatus, error: string | null = null) => {
    record.status = status;
    record.error = error;
    publish();
  };

  const toEntry = (record: SandboxRecord): RegistryEntry => ({
    worktreePath: record.worktreePath,
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
    worktreePath: string,
    gitCommonDir: string,
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
      { path: worktreePath, readOnly: false },
      { path: gitCommonDir, readOnly: false },
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
      // covers only read-only paths, so the worktree and git dir stay writable.
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
      if (mount.file || mount.path === record.worktreePath) continue;
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
        record.worktreePath,
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
        record.worktreePath,
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
      record.worktreePath,
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
    return yield* fail("start", record.worktreePath, "The sandbox's exec server did not start.")();
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
      onExit: (detail) => {
        if (record.tunnel !== tunnel) return;
        record.tunnel = null;
        // The relay only exits by itself when the sandbox or its runtime went away.
        if (detail !== "closed") {
          setStatus(record, "stopped");
          PubSub.publishUnsafe(stoppedWorktrees, record.worktreePath);
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
  const startUnlocked = (record: SandboxRecord, onOutput: (line: string) => void = () => {}) =>
    Effect.gen(function* () {
      // A lookup can hold a record that Remove deleted while it waited for the lock.
      if (records.get(record.worktreePath) !== record) return false;
      if (record.status === "running" && record.tunnel?.alive === true) return true;
      setStatus(record, "starting");
      const backend = backendOf(record);
      const state = yield* backend.state(record.containerName);
      if (state === "missing") {
        yield* backend.ensureAvailable(record.worktreePath);
        record.image = yield* backend.ensureImage(
          { uid, gid, home, versions: record.versions },
          onOutput,
        );
        yield* persistOrLog;
        onOutput(`Starting sandbox ${record.containerName}`);
        yield* backend.create({
          name: record.containerName,
          worktreePath: record.worktreePath,
          image: record.image,
          versions: record.versions,
          mounts: record.mounts,
          uid,
          gid,
          home,
          ipv6Loopback: mcpReverse?.host === "::1",
          ...(backend.execServer
            ? {
                execHostPort: (record.execPort = yield* freeHostPort(
                  preferredSandboxHostPort(record.containerName, SANDBOX_EXEC_GUEST_PORT),
                )),
              }
            : {}),
        });
        // The env-file folder must exist on the host before any exec.
        yield* fileSystem
          .makeDirectory(controlDir(record.containerName), { recursive: true })
          .pipe(Effect.ignore);
      } else if (state !== "running") {
        yield* backend.start(record.containerName, record.worktreePath);
      }
      if (state !== "running") yield* copyIn(record);
      yield* ensureExecServer(record);
      if (!record.reaped) {
        // Commands an earlier server process started outlive it in the
        // sandbox; stop them like the host stops orphaned terminals.
        yield* cliFor(backend.command)(
          "start",
          record.worktreePath,
          backend.execArgs({
            name: record.containerName,
            tty: false,
            argv: ["node", "-e", SANDBOX_KILL_SOURCE, "--all"],
          }),
        ).pipe(Effect.ignore);
        record.reaped = true;
      }
      if (!gitEnvs.has(record.worktreePath)) {
        gitEnvs.set(record.worktreePath, yield* gitEnvFor(record.worktreePath));
      }
      if (record.tunnel?.alive !== true) startTunnel(record);
      record.lastUsedAt = Date.now();
      setStatus(record, "running");
      return true;
    }).pipe(
      Effect.mapError((error) => (Schema.is(SandboxError)(error) ? error : fromBackend(error))),
      Effect.tapError((error) => Effect.sync(() => setStatus(record, "error", error.detail))),
    );

  const ensureRunning = (record: SandboxRecord) =>
    record.lock.withPermits(1)(startUnlocked(record));

  const recordFor = (cwd: string) => {
    for (const record of records.values()) {
      if (containsPath(record.worktreePath, cwd, path.sep)) return record;
    }
    return undefined;
  };

  /** True when `cwd` might be sandboxed but the list is unverified. Retries the rebuild once. */
  const unknownSandbox = (cwd: string) =>
    Effect.gen(function* () {
      if (!unverified || !containsPath(serverConfig.worktreesDir, cwd, path.sep)) return false;
      yield* reconcileOnce;
      return unverified && recordFor(cwd) === undefined;
    });

  const makeExecTarget = (record: SandboxRecord): SandboxExecTarget => ({
    worktreePath: record.worktreePath,
    containerName: record.containerName,
    command: (input) => {
      for (const name of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]) {
        const value = input.env[name];
        if (value === undefined || value === hostEnv[name]) continue;
        if (!record.mounts.some((mount) => containsPath(mount.path, value, path.sep))) {
          throw fail(
            "exec",
            record.worktreePath,
            `This provider uses ${name}=${value}, which this sandbox does not mount. Start a new sandbox after changing a provider's home folder.`,
          )();
        }
      }
      const execId = NodeCrypto.randomUUID();
      const envFile = path.join(controlDir(record.containerName), `${execId}.env`);
      const env: Record<string, string> = { ...gitEnvs.get(record.worktreePath) };
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
   * The marker file for a worktree: `<git admin dir>/t3code-sandbox.json`,
   * found through the `.git` file a linked worktree has at its root.
   */
  const markerPath = (worktreePath: string) =>
    fileSystem.readFileString(path.join(worktreePath, ".git")).pipe(
      Effect.map((text) => /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()),
      Effect.map((gitDir) =>
        gitDir === undefined
          ? undefined
          : path.join(path.resolve(worktreePath, gitDir), MARKER_FILE),
      ),
      Effect.orElseSucceed(() => undefined),
    );

  /**
   * Rebuilds a sandbox from the marker in its worktree when the saved list
   * lost it, so a lost list never lets sandboxed work start on the host.
   */
  const recordFromMarker = (cwd: string) =>
    Effect.gen(function* () {
      // Every ancestor is checked, so a submodule or nested repository inside
      // a sandboxed worktree still finds the worktree's marker.
      let dir = cwd;
      while (true) {
        const marker = yield* markerPath(dir);
        const entry =
          marker === undefined
            ? undefined
            : yield* fileSystem.readFileString(marker).pipe(
                Effect.flatMap(decodeMarker),
                Effect.orElseSucceed(() => undefined),
              );
        if (entry !== undefined && entry.worktreePath === dir) {
          const existing = records.get(entry.worktreePath);
          if (existing !== undefined) return existing;
          addLoadedRecord(entry);
          publish();
          yield* persistOrLog;
          return records.get(entry.worktreePath);
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
    });

  /** The sandbox owning `cwd`, from memory or its worktree's marker. */
  const lookup = (cwd: string) =>
    Effect.suspend(() => {
      const record = recordFor(cwd);
      return record === undefined ? recordFromMarker(cwd) : Effect.succeed(record);
    });

  const register: SandboxService["Service"]["register"] = Effect.fn("SandboxService.register")(
    function* (input) {
      yield* Deferred.await(ready);
      if (!supported) {
        return yield* fail(
          "create",
          input.worktreePath,
          "Sandboxes run on Linux and macOS hosts.",
        )();
      }
      if (!isMountablePath(input.worktreePath)) {
        return yield* fail(
          "create",
          input.worktreePath,
          "Sandboxes cannot mount a path that contains a comma or a colon.",
        )();
      }
      const gitCommonDir = yield* processRunner
        .run({
          command: "git",
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          cwd: input.worktreePath,
          env: hostEnv,
        })
        .pipe(
          Effect.flatMap((result) =>
            result.code === 0 && result.stdout.trim().length > 0
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(result.stderr),
          ),
          Effect.mapError(
            fail("create", input.worktreePath, "Could not find the worktree's git folder."),
          ),
        );
      records.get(input.worktreePath)?.tunnel?.close();
      const containerName = sandboxContainerName(input.worktreePath);
      const record: SandboxRecord = {
        worktreePath: input.worktreePath,
        containerName,
        backend: defaultBackend,
        versions: {
          claude: providerVersion(input.providers, SANDBOX_DRIVERS.claude),
          codex: providerVersion(input.providers, SANDBOX_DRIVERS.codex),
        },
        mounts: yield* mountsFor(
          containerName,
          input.worktreePath,
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
        execPort: null,
        lock: Semaphore.makeUnsafe(1),
      };
      // Saved before the slow start, so terminals opened during the build wait
      // for the sandbox instead of starting on the host. A failed start leaves
      // the record in place for the next attempt.
      records.set(record.worktreePath, record);
      publish();
      const marker = yield* markerPath(record.worktreePath);
      yield* persist.pipe(
        Effect.andThen(
          marker === undefined
            ? fail("create", record.worktreePath, "The worktree has no git admin folder.")()
            : encodeMarker(toEntry(record)).pipe(
                Effect.flatMap((contents) =>
                  writeFileStringAtomically({ filePath: marker, contents }),
                ),
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
                Effect.mapError(
                  fail("create", record.worktreePath, "Could not mark the worktree as sandboxed."),
                ),
              ),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            records.delete(record.worktreePath);
            publish();
          }).pipe(Effect.andThen(persistOrLog)),
        ),
      );
    },
  );

  const start: SandboxService["Service"]["start"] = Effect.fn("SandboxService.start")(
    function* (input) {
      const record = records.get(input.worktreePath);
      if (record === undefined) {
        return yield* fail("start", input.worktreePath, "This worktree has no sandbox.")();
      }
      const onOutput = (line: string) => {
        if (input.onOutput) Effect.runFork(input.onOutput(line));
      };
      yield* record.lock.withPermits(1)(startUnlocked(record, onOutput));
      return summarize(record);
    },
  );

  const execTarget: SandboxService["Service"]["execTarget"] = (cwd) =>
    Effect.gen(function* () {
      yield* Deferred.await(ready);
      if (yield* unknownSandbox(cwd)) {
        return yield* fail(
          "start",
          cwd,
          "T3 could not read its sandbox list and the sandbox runtime is not reachable, so it cannot tell whether this worktree runs in a sandbox. Start the runtime and try again.",
        )();
      }
      const record = yield* lookup(cwd);
      if (record === undefined) return Option.none();
      return (yield* ensureRunning(record)) ? Option.some(makeExecTarget(record)) : Option.none();
    });

  /** Stops a sandbox. Callers hold the record lock. */
  const stopUnlocked = (record: SandboxRecord) =>
    Effect.gen(function* () {
      record.tunnel?.close();
      record.tunnel = null;
      yield* backendOf(record)
        .stop(record.containerName, record.worktreePath)
        .pipe(Effect.mapError(fromBackend));
      // The sandbox's processes are gone, so nothing is left to reap.
      record.reaped = true;
      record.activeExecs = 0;
      setStatus(record, "stopped");
      PubSub.publishUnsafe(stoppedWorktrees, record.worktreePath);
    });

  const stop: SandboxService["Service"]["stop"] = (worktreePath) =>
    Effect.gen(function* () {
      const record = records.get(worktreePath);
      if (record === undefined) return;
      yield* record.lock.withPermits(1)(stopUnlocked(record));
    });

  const remove: SandboxService["Service"]["remove"] = (worktreePath) =>
    Effect.gen(function* () {
      const record = records.get(worktreePath);
      if (record === undefined) return;
      yield* record.lock.withPermits(1)(
        Effect.gen(function* () {
          record.tunnel?.close();
          record.tunnel = null;
          // A failed first start can leave no sandbox to delete.
          yield* backendOf(record)
            .remove(record.containerName, worktreePath)
            .pipe(Effect.mapError(fromBackend));
          records.delete(worktreePath);
          gitEnvs.delete(worktreePath);
          publish();
          PubSub.publishUnsafe(stoppedWorktrees, worktreePath);
          yield* persistOrLog;
          const marker = yield* markerPath(worktreePath);
          if (marker !== undefined) yield* fileSystem.remove(marker).pipe(Effect.ignore);
          yield* fileSystem
            .remove(controlDir(record.containerName), { recursive: true })
            .pipe(Effect.ignore);
        }),
      );
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
      (record.tunnel?.ports ?? []).map((port) => ({ worktreePath: record.worktreePath, ...port })),
    );

  const worktreeExists = (worktreePath: string) =>
    fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false));

  const addLoadedRecord = (entry: RegistryEntry) =>
    records.set(entry.worktreePath, {
      ...entry,
      backend: entry.backend ?? "docker",
      status: "stopped",
      error: null,
      tunnel: null,
      reaped: false,
      activeExecs: 0,
      lastUsedAt: Date.now(),
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
   * Adopts labeled sandboxes the saved list does not know, drops sandboxes
   * whose worktree is gone, and reconnects sandboxes that are still running
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
        if (records.has(instance.worktreePath)) continue;
        addLoadedRecord({
          worktreePath: instance.worktreePath,
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
      if (yield* worktreeExists(record.worktreePath)) continue;
      records.delete(record.worktreePath);
      changed = true;
      yield* backendOf(record)
        .remove(record.containerName, record.worktreePath)
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
    Effect.flatMap((runningRecords) =>
      Effect.forEach(runningRecords, (record) => ensureRunning(record).pipe(Effect.ignore), {
        discard: true,
      }),
    ),
    Effect.ensuring(Deferred.succeed(ready, undefined)),
    Effect.forkScoped,
  );

  // Idle sandboxes stop so a machine running many of them only pays for the
  // busy ones. Busy means a command T3 started is still running or bytes
  // crossed the relay (a preview tab, MCP, git over SSH) within the window.
  // The next command starts the sandbox again.
  const idleMs = idleMinutes(hostEnv) * 60_000;
  if (idleMs > 0) {
    yield* Effect.gen(function* () {
      const now = Date.now();
      for (const record of records.values()) {
        if (record.status !== "running" || record.activeExecs > 0) continue;
        if ((record.tunnel?.connections ?? 0) > 0) continue;
        const lastActive = Math.max(record.lastUsedAt, record.tunnel?.lastActivityAt ?? 0);
        if (now - lastActive < idleMs) continue;
        yield* record.lock
          .withPermits(1)(
            // Recheck under the lock: a command may have started meanwhile.
            record.activeExecs > 0 || record.status !== "running"
              ? Effect.void
              : stopUnlocked(record).pipe(
                  Effect.tap(() =>
                    Effect.logInfo("Stopped an idle sandbox", {
                      worktreePath: record.worktreePath,
                    }),
                  ),
                ),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not stop an idle sandbox", { cause }),
            ),
          );
      }
    }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const record of records.values()) record.tunnel?.close();
    }),
  );

  return SandboxService.of({
    supported,
    backend: defaultBackend,
    register,
    start,
    execTarget,
    isSandboxed: (cwd) =>
      Deferred.await(ready).pipe(
        Effect.andThen(unknownSandbox(cwd)),
        Effect.flatMap((unknown) =>
          unknown
            ? Effect.succeed(true)
            : lookup(cwd).pipe(Effect.map((record) => record !== undefined)),
        ),
      ),
    stop,
    remove,
    list,
    stream,
    forwardedPorts,
    stopped: Stream.fromPubSub(stoppedWorktrees),
  });
});

export const layer = Layer.effect(SandboxService, make);
