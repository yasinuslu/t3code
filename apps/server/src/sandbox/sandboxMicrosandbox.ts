import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  SANDBOX_LABELS,
  sandboxBaseEnv,
  sandboxProvisionScript,
  type SandboxBackend,
  type SandboxBackendError,
  type SandboxCreateSpec,
  type SandboxImageSpec,
} from "./SandboxBackend.ts";
import { shortHash } from "./sandboxCommon.ts";
import { SANDBOX_EXEC_GUEST_PORT } from "./sandboxExecServer.ts";
import type { SandboxCli } from "./sandboxDocker.ts";

/**
 * microsandbox (`msb`) runs each sandbox as a libkrun microVM: its own kernel,
 * so a sandbox cannot see host processes or files beyond its mounts. Folders
 * are shared over virtiofs at their host paths and keep the host uid.
 *
 * msb cannot build Dockerfiles. The base image is a snapshot instead: a
 * builder VM boots `node:24-bookworm`, runs `sandboxProvisionScript` as root,
 * stops, and is snapshotted. Sandboxes boot from that snapshot with
 * `msb run --snapshot`, which takes about two seconds.
 */
const BASE_IMAGE = "node:24-bookworm";

/** Resources per sandbox. nika runs many of these, so the defaults stay small. */
export interface MicrosandboxResources {
  readonly cpus: number;
  readonly memory: string;
}

export const microsandboxResources = (env: NodeJS.ProcessEnv): MicrosandboxResources => {
  const cpus = Number.parseInt(env.T3CODE_SANDBOX_CPUS ?? "", 10);
  return {
    cpus: Number.isInteger(cpus) && cpus > 0 ? cpus : 2,
    memory: /^\d+[MG]$/i.test(env.T3CODE_SANDBOX_MEMORY ?? "") ? env.T3CODE_SANDBOX_MEMORY! : "4G",
  };
};

/** Snapshots are content addressed, so a new CLI version provisions a new one. */
export const microsandboxSnapshotName = (spec: SandboxImageSpec): string =>
  `t3code-sandbox-base-${shortHash(JSON.stringify([BASE_IMAGE, sandboxProvisionScript(spec)]), 12)}`;

// Parents first: msb mounts in order, so a read-only parent listed later
// would hide a writable child such as the project's git dir.
const volumeArgs = (spec: SandboxCreateSpec) =>
  spec.mounts
    .toSorted((a, b) => a.path.length - b.path.length)
    .flatMap((mount) => [
      mount.file ? "--mount-file" : "-v",
      `${mount.path}:${mount.path}${mount.readOnly ? ":ro" : ""}`,
    ]);

/**
 * `msb run` arguments for one sandbox. The VM's own idle timeout only backs
 * up T3's idle stop: the relay keeps an exec open while T3 runs, so it only
 * fires after the server is gone.
 */
export const microsandboxRunArgs = (
  input: SandboxCreateSpec & { readonly owner: string; readonly resources: MicrosandboxResources },
): ReadonlyArray<string> => [
  "run",
  "--quiet",
  "--detach",
  "--replace",
  "--snapshot",
  input.image,
  "--name",
  input.name,
  "--hostname",
  "t3-sandbox",
  "--user",
  `${input.uid}:${input.gid}`,
  "--cpus",
  String(input.resources.cpus),
  "--memory",
  input.resources.memory,
  "--idle-timeout",
  "30m",
  "--label",
  `${SANDBOX_LABELS.sandbox}=1`,
  "--label",
  `${SANDBOX_LABELS.owner}=${input.owner}`,
  "--label",
  `${SANDBOX_LABELS.worktree}=${input.worktreePath}`,
  "--label",
  `${SANDBOX_LABELS.claude}=${input.versions.claude}`,
  "--label",
  `${SANDBOX_LABELS.codex}=${input.versions.codex}`,
  ...Object.entries(sandboxBaseEnv(input.home)).flatMap(([name, value]) => [
    "--env",
    `${name}=${value}`,
  ]),
  ...(input.execHostPort === undefined
    ? []
    : ["--port", `127.0.0.1:${input.execHostPort}:${SANDBOX_EXEC_GUEST_PORT}`]),
  ...volumeArgs(input),
];

const ListedSandboxes = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
);
const InspectedSandbox = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.String,
    config: Schema.Struct({
      labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
      mounts: Schema.Array(
        Schema.Struct({
          type: Schema.String,
          guest: Schema.String,
          host: Schema.optional(Schema.String),
          options: Schema.optional(Schema.Struct({ readonly: Schema.Boolean })),
        }),
      ),
      network: Schema.optional(
        Schema.Struct({
          ports: Schema.optional(
            Schema.Array(Schema.Struct({ guest_port: Schema.Number, host_port: Schema.Number })),
          ),
        }),
      ),
    }),
  }),
);
const decodeListed = Schema.decodeUnknownEffect(ListedSandboxes);
const decodeInspected = Schema.decodeUnknownEffect(InspectedSandbox);

export const makeMicrosandboxBackend = (input: {
  readonly cli: SandboxCli;
  readonly owner: string;
  readonly registryPath: string;
  readonly resources: MicrosandboxResources;
  readonly kvmAvailable: () => Effect.Effect<boolean>;
}): SandboxBackend => {
  const { cli, owner } = input;
  const missing = (error: SandboxBackendError) => /not found/i.test(error.detail);
  const decodeError =
    (worktreePath: string) =>
    (cause: SandboxBackendError | Schema.SchemaError): SandboxBackendError =>
      "detail" in cause
        ? cause
        : { operation: "start", worktreePath, detail: "Could not read msb output.", cause };

  const ensureImage: SandboxBackend["ensureImage"] = (spec, onOutput) =>
    Effect.gen(function* () {
      const snapshot = microsandboxSnapshotName(spec);
      const exists = yield* cli("start", snapshot, ["snapshot", "inspect", snapshot]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (exists) return snapshot;
      const builder = `${snapshot}-builder`;
      onOutput(`Building sandbox base ${snapshot} (first sandbox only, a few minutes)`);
      yield* cli("start", snapshot, ["remove", "--force", builder]).pipe(Effect.ignore);
      yield* cli(
        "start",
        snapshot,
        ["create", "--quiet", "--name", builder, "--cpus", "4", "--memory", "4G", BASE_IMAGE],
        { timeoutMs: 10 * 60_000 },
      );
      yield* cli(
        "start",
        snapshot,
        [
          "exec",
          "--quiet",
          "--user",
          "root",
          builder,
          "--",
          "/bin/sh",
          "-c",
          sandboxProvisionScript(spec),
        ],
        { onLine: onOutput, timeoutMs: 30 * 60_000 },
      ).pipe(
        Effect.tapError(() =>
          cli("start", snapshot, ["remove", "--force", builder]).pipe(Effect.ignore),
        ),
      );
      yield* cli("start", snapshot, ["stop", builder]);
      yield* cli(
        "start",
        snapshot,
        [
          "snapshot",
          "create",
          "--quiet",
          "--force",
          "--label",
          `${SANDBOX_LABELS.sandbox}=1`,
          "--from",
          builder,
          snapshot,
        ],
        { timeoutMs: 10 * 60_000 },
      );
      yield* cli("start", snapshot, ["remove", "--force", builder]).pipe(Effect.ignore);
      return snapshot;
    });

  const inspect = (name: string) =>
    cli("start", name, ["inspect", "--format", "json", name]).pipe(
      Effect.flatMap(decodeInspected),
      Effect.mapError(decodeError(name)),
    );

  return {
    kind: "microsandbox",
    label: "microsandbox",
    command: "msb",
    execServer: true,
    execHostPort: (name) =>
      inspect(name).pipe(
        Effect.map(
          (sandbox) =>
            sandbox.config.network?.ports?.find(
              (port) => port.guest_port === SANDBOX_EXEC_GUEST_PORT,
            )?.host_port ?? null,
        ),
        Effect.orElseSucceed(() => null),
      ),
    ensureAvailable: (worktreePath) =>
      Effect.gen(function* () {
        yield* cli("start", worktreePath, ["--version"]).pipe(
          Effect.mapError((error) => ({
            ...error,
            detail: `microsandbox (msb) is not installed or not on PATH. (${error.detail})`,
          })),
        );
        if (!(yield* input.kvmAvailable())) {
          return yield* Effect.fail<SandboxBackendError>({
            operation: "start",
            worktreePath,
            detail: "microsandbox needs /dev/kvm, which this machine does not expose.",
          });
        }
      }),
    ensureImage,
    create: (spec) =>
      cli(
        "start",
        spec.worktreePath,
        microsandboxRunArgs({ ...spec, owner, resources: input.resources }),
      ).pipe(Effect.asVoid),
    state: (name) =>
      inspect(name).pipe(
        Effect.map((sandbox) =>
          /^running$/i.test(sandbox.status) ? ("running" as const) : ("stopped" as const),
        ),
        Effect.orElseSucceed(() => "missing" as const),
      ),
    start: (name, worktreePath) =>
      cli("start", worktreePath, ["start", "--quiet", name]).pipe(Effect.asVoid),
    stop: (name, worktreePath) =>
      cli("stop", worktreePath, ["stop", "--quiet", name]).pipe(Effect.asVoid),
    remove: (name, worktreePath) =>
      cli("remove", worktreePath, ["remove", "--force", "--quiet", name]).pipe(
        Effect.catchIf(missing, () => Effect.void),
        Effect.asVoid,
      ),
    listOwned: Effect.gen(function* () {
      const listed = yield* cli("start", input.registryPath, [
        "list",
        "--format",
        "json",
        "--label",
        `${SANDBOX_LABELS.owner}=${owner}`,
      ]).pipe(Effect.flatMap(decodeListed), Effect.mapError(decodeError(input.registryPath)));
      const owned = yield* Effect.forEach(listed, (entry) =>
        inspect(entry.name).pipe(
          Effect.map((sandbox) => ({ entry, sandbox })),
          Effect.option,
        ),
      );
      return owned.flatMap((found) => {
        if (found._tag === "None") return [];
        const { entry, sandbox } = found.value;
        const labels = sandbox.config.labels ?? {};
        const worktreePath = labels[SANDBOX_LABELS.worktree];
        if (worktreePath === undefined) return [];
        return [
          {
            name: entry.name,
            worktreePath,
            // The snapshot is not recorded on the sandbox; a re-create rebuilds the name.
            image: "",
            versions: {
              claude: labels[SANDBOX_LABELS.claude] ?? "latest",
              codex: labels[SANDBOX_LABELS.codex] ?? "latest",
            },
            mounts: sandbox.config.mounts
              .filter((mount) => mount.type === "Bind" && mount.host === mount.guest)
              .map((mount) => ({
                path: mount.guest,
                readOnly: mount.options?.readonly ?? false,
              })),
            running: /^running$/i.test(entry.status),
          },
        ];
      });
    }),
    execArgs: ({ name, cwd, tty, root, argv }) => [
      "exec",
      "--quiet",
      ...(tty ? ["--tty"] : []),
      ...(cwd === undefined ? [] : ["--workdir", cwd]),
      ...(root ? ["--user", "root"] : []),
      name,
      "--",
      ...argv,
    ],
  };
};
