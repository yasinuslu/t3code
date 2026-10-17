// @effect-diagnostics nodeBuiltinImport:off -- The switch command must outlive this app, so it runs as a detached Node child.

import * as NodeChildProcess from "node:child_process";

import * as Schema from "effect/Schema";

/**
 * A build staged next to the running app by an external installer, for installs that do not
 * update through an electron-updater feed (for example an app run from a source checkout).
 * The installer writes this JSON to `T3CODE_DESKTOP_STAGED_UPDATE_FILE` while it prepares a
 * build ("preparing") and once it can be switched to ("ready"), and removes the file when the
 * build goes live. `T3CODE_DESKTOP_STAGED_UPDATE_COMMAND` switches to it: it runs detached and
 * is expected to stop this app and start the staged build.
 */
export const StagedBuild = Schema.Struct({
  status: Schema.Literals(["preparing", "ready"]),
  version: Schema.String,
});
export type StagedBuild = typeof StagedBuild.Type;

const decodeStagedBuild = Schema.decodeUnknownOption(Schema.fromJsonString(StagedBuild));

/** The staged build a file describes; null when it is missing, empty, or unreadable. */
export function parseStagedBuild(raw: string | null): StagedBuild | null {
  if (raw === null || raw.trim().length === 0) return null;
  const decoded = decodeStagedBuild(raw);
  return decoded._tag === "Some" ? decoded.value : null;
}

/** Starts the switch command in its own process group; reports a launch failure or non-zero exit. */
export function spawnStagedBuildSwitch(
  command: string,
  onFailure: (message: string) => void,
): void {
  const child = NodeChildProcess.spawn(command, { shell: true, detached: true, stdio: "ignore" });
  child.on("error", (error) => onFailure(`Could not run the switch command: ${error.message}`));
  child.on("exit", (code) => {
    if (code !== 0) onFailure(`The switch command exited with code ${code}.`);
  });
  child.unref();
}
