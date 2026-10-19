import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  SANDBOX_LABELS,
  sandboxProvisionScript,
  type SandboxBackend,
  type SandboxBackendError,
  type SandboxCreateSpec,
  type SandboxImageSpec,
} from "./SandboxBackend.ts";
import { shortHash } from "./sandboxCommon.ts";

/**
 * The Docker sandbox image: a Debian Node image provisioned by
 * `sandboxProvisionScript`, with sleep as PID 1 so the container stays up.
 */
export const sandboxDockerfile = (spec: SandboxImageSpec) => `FROM node:24
RUN ["/bin/sh", "-c", ${JSON.stringify(sandboxProvisionScript(spec))}]
USER ${spec.uid}:${spec.gid}
ENV HOME=${spec.home} SHELL=/bin/bash
CMD ["sleep", "infinity"]
`;

/** Images are content addressed, so a new CLI version builds a new image. */
export const sandboxImageTag = (spec: SandboxImageSpec): string =>
  `t3code-sandbox:${shortHash(sandboxDockerfile(spec), 12)}`;

/** Each mount lands at the same path inside the container. */
export const dockerRunArgs = (input: SandboxCreateSpec & { readonly owner: string }) => [
  "run",
  "--detach",
  "--init",
  "--name",
  input.name,
  "--hostname",
  "t3-sandbox",
  "--label",
  `${SANDBOX_LABELS.sandbox}=1`,
  "--label",
  `${SANDBOX_LABELS.owner}=${input.owner}`,
  "--label",
  `${SANDBOX_LABELS.workspace}=${input.workspacePath}`,
  "--label",
  `${SANDBOX_LABELS.claude}=${input.versions.claude}`,
  "--label",
  `${SANDBOX_LABELS.codex}=${input.versions.codex}`,
  ...(input.ipv6Loopback ? ["--sysctl", "net.ipv6.conf.lo.disable_ipv6=0"] : []),
  ...input.mounts.flatMap((mount) => [
    "--mount",
    `type=bind,source=${mount.path},target=${mount.path}${mount.readOnly ? ",readonly" : ""}`,
  ]),
  input.image,
];

/** The parts of `docker inspect` output used to adopt a labeled container. */
const InspectedContainers = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      Name: Schema.String,
      Config: Schema.Struct({
        Image: Schema.String,
        Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
      }),
      State: Schema.Struct({ Running: Schema.Boolean }),
      Mounts: Schema.NullOr(
        Schema.Array(
          Schema.Struct({ Source: Schema.String, Destination: Schema.String, RW: Schema.Boolean }),
        ),
      ),
    }),
  ),
);
const decodeInspected = Schema.decodeUnknownEffect(InspectedContainers);

export type SandboxCli = (
  operation: SandboxBackendError["operation"],
  workspacePath: string,
  args: ReadonlyArray<string>,
  options?: {
    readonly stdin?: string;
    readonly onLine?: (line: string) => void;
    /** Defaults to two minutes; image builds pass more. */
    readonly timeoutMs?: number;
  },
) => Effect.Effect<string, SandboxBackendError>;

export const makeDockerBackend = (input: {
  readonly cli: SandboxCli;
  readonly owner: string;
  readonly registryPath: string;
}): SandboxBackend => {
  const { cli, owner } = input;
  const missing = (error: SandboxBackendError) => /no such (container|object)/i.test(error.detail);
  return {
    kind: "docker",
    label: "Docker",
    command: "docker",
    execServer: false,
    execHostPort: () => Effect.succeed(null),
    ensureAvailable: (workspacePath) =>
      cli("start", workspacePath, ["version", "--format", "{{.Server.Version}}"]).pipe(
        Effect.mapError((error) => ({
          ...error,
          detail: `Docker is not running. Start Docker and try again. (${error.detail})`,
        })),
        Effect.asVoid,
      ),
    ensureImage: (spec, onOutput) =>
      Effect.gen(function* () {
        const tag = sandboxImageTag(spec);
        const exists = yield* cli("start", tag, ["image", "inspect", tag]).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (!exists) {
          onOutput(`Building sandbox image ${tag}`);
          yield* cli(
            "start",
            tag,
            ["build", "--progress=plain", "--label", `${SANDBOX_LABELS.sandbox}=1`, "-t", tag, "-"],
            { stdin: sandboxDockerfile(spec), onLine: onOutput, timeoutMs: 30 * 60_000 },
          );
        }
        return tag;
      }),
    create: (spec) =>
      Effect.gen(function* () {
        yield* cli("start", spec.workspacePath, ["rm", "--force", spec.name]).pipe(Effect.ignore);
        yield* cli("start", spec.workspacePath, dockerRunArgs({ ...spec, owner }));
      }),
    state: (name) =>
      cli("start", name, ["inspect", "--format", "{{.State.Running}}", name]).pipe(
        Effect.map((running) => (running === "true" ? ("running" as const) : ("stopped" as const))),
        Effect.orElseSucceed(() => "missing" as const),
      ),
    start: (name, workspacePath) =>
      cli("start", workspacePath, ["start", name]).pipe(Effect.asVoid),
    stop: (name, workspacePath) =>
      cli("stop", workspacePath, ["stop", "--time", "3", name]).pipe(Effect.asVoid),
    remove: (name, workspacePath) =>
      cli("remove", workspacePath, ["rm", "--force", name]).pipe(
        Effect.catchIf(missing, () => Effect.succeed("")),
        Effect.asVoid,
      ),
    listOwned: Effect.gen(function* () {
      const names = yield* cli("start", input.registryPath, [
        "ps",
        "--all",
        "--filter",
        `label=${SANDBOX_LABELS.owner}=${owner}`,
        "--format",
        "{{.Names}}",
      ]);
      if (names.length === 0) return [];
      const containers = yield* cli("start", input.registryPath, [
        "inspect",
        ...names.split("\n"),
      ]).pipe(
        Effect.flatMap(decodeInspected),
        Effect.mapError((cause) =>
          "detail" in cause
            ? cause
            : {
                operation: "start" as const,
                workspacePath: input.registryPath,
                detail: "Could not read docker inspect output.",
                cause,
              },
        ),
      );
      return containers.flatMap((container) => {
        const labels = container.Config.Labels ?? {};
        const workspacePath = labels[SANDBOX_LABELS.workspace];
        if (workspacePath === undefined) return [];
        return [
          {
            name: container.Name.replace(/^\//, ""),
            workspacePath,
            image: container.Config.Image,
            versions: {
              claude: labels[SANDBOX_LABELS.claude] ?? "latest",
              codex: labels[SANDBOX_LABELS.codex] ?? "latest",
            },
            mounts: (container.Mounts ?? [])
              .filter((mount) => mount.Source === mount.Destination)
              .map((mount) => ({ path: mount.Source, readOnly: !mount.RW })),
            running: container.State.Running,
          },
        ];
      });
    }),
    execArgs: ({ name, cwd, tty, root, argv }) => [
      "exec",
      tty ? "-it" : "-i",
      ...(cwd === undefined ? [] : ["-w", cwd]),
      ...(root ? ["-u", "0"] : []),
      name,
      ...argv,
    ],
  };
};
