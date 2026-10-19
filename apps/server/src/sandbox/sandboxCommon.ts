// @effect-diagnostics nodeBuiltinImport:off - hashing sandbox names.
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

export const shortHash = (value: string, length: number) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, length);

/** Owner label value for a server state dir. */
export const sandboxOwner = (stateDir: string): string => shortHash(stateDir, 16);

/** Stable per workspace, readable in `docker ps` and `msb ls`. */
export const sandboxContainerName = (workspacePath: string): string => {
  const slug =
    NodePath.basename(workspacePath)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .slice(0, 40)
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || "workspace";
  return `t3code-sandbox-${slug}-${shortHash(workspacePath, 8)}`;
};

/**
 * Host port to try first for a forwarded sandbox port. Stable per sandbox and
 * port, so preview URLs survive server restarts.
 */
export const preferredSandboxHostPort = (containerName: string, containerPort: number): number =>
  42000 + (Number.parseInt(shortHash(`${containerName}:${containerPort}`, 6), 16) % 8000);

/** Mount options are separated by commas and colons, so such paths cannot be expressed. */
export const isMountablePath = (path: string): boolean =>
  !path.includes(",") && !path.includes(":");

const SKIPPED_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOSTNAME",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "SSH_AUTH_SOCK",
  "NODE_OPTIONS",
  "NODE_PATH",
  "APPIMAGE",
  "APPDIR",
  "OWD",
  "ARGV0",
]);
const SKIPPED_PREFIXES = [
  "XDG_",
  "DBUS_",
  "LD_",
  "DYLD_",
  "ELECTRON_",
  "VSCODE_",
  "TERM_PROGRAM",
  "__CF",
  "npm_",
  "CHROME_",
  "NIX_",
];
/** Inherited host variables worth passing: provider credentials, proxies, locale. */
const INHERITED_NAMES =
  /^(ANTHROPIC_|CLAUDE_|OPENAI_|CODEX_|AWS_|GOOGLE_|GEMINI_|VERTEX_|AZURE_|LC_)|^(HTTPS?_PROXY|NO_PROXY|ALL_PROXY|https?_proxy|no_proxy|all_proxy|LANG|TERM|COLORTERM|TZ|GH_TOKEN|GITHUB_TOKEN)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names of the variables a sandboxed command should receive. A command's env
 * is usually the server's own env plus overrides. Host paths and session
 * plumbing (PATH, HOME, XDG_*) would break inside the sandbox, so only the
 * overrides and a short list of inherited credentials and locale pass through.
 */
export const sandboxEnvNames = (
  env: NodeJS.ProcessEnv,
  hostEnv: NodeJS.ProcessEnv,
): ReadonlyArray<string> =>
  Object.keys(env)
    .filter((name) => {
      const value = env[name];
      if (value === undefined || !ENV_NAME.test(name)) return false;
      if (SKIPPED_NAMES.has(name) || SKIPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        return false;
      }
      return value !== hostEnv[name] || INHERITED_NAMES.test(name);
    })
    .toSorted();

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A POSIX shell file that exports `env`. Commands read their env from one of
 * these instead of the exec argv, where any local process could read secrets.
 */
export const renderSandboxEnvFile = (env: Readonly<Record<string, string>>): string =>
  Object.entries(env)
    .filter(([name]) => ENV_NAME.test(name))
    .map(([name, value]) => `export ${name}=${shellQuote(value)}\n`)
    .join("");

/**
 * Wraps a command so the sandbox records its PID and start time under the
 * exec id, loads and deletes its env file, then runs it. `SANDBOX_KILL_SOURCE`
 * uses the record to stop it later. The launcher is `sh`, whose stat line has
 * no spaces before field 22.
 */
export const sandboxExecLauncherArgs = (
  execId: string,
  envFile: string,
  command: string,
  args: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  "/bin/sh",
  "-c",
  'mkdir -p /tmp/.t3-exec && echo "$$ $(cut -d" " -f22 /proc/$$/stat)" > "/tmp/.t3-exec/$0" && if [ -n "$1" ]; then . "$1" && rm -f "$1"; fi && shift && exec "$@"',
  execId,
  envFile,
  command,
  ...args,
];
