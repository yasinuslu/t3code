// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  FilesystemCodeProfile,
  FilesystemCodeProfilesInput,
  FilesystemCodeProfilesResult,
} from "@t3tools/contracts";

/** Directory under the home directory that holds code profiles. */
export const CODE_PROFILES_DIRECTORY = "code";

async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await NodeFSP.realpath(path);
  } catch {
    return path;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await NodeFSP.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists `<home>/code/<profile>` directories that contain `<profile>-brain`,
 * then places each input path in the profile whose real path contains it.
 * Paths that do not exist, or sit outside every profile, get `null`.
 */
export async function resolveCodeProfiles(
  input: FilesystemCodeProfilesInput,
  homeDir: string = NodeOS.homedir(),
): Promise<FilesystemCodeProfilesResult> {
  const root = NodePath.join(homeDir, CODE_PROFILES_DIRECTORY);
  let names: string[] = [];
  try {
    names = await NodeFSP.readdir(root);
  } catch {
    names = [];
  }
  const profiles = (
    await Promise.all(
      names
        .filter((name) => !name.startsWith("."))
        .map(async (name): Promise<FilesystemCodeProfile | null> => {
          const directory = NodePath.join(root, name);
          if (!(await isDirectory(NodePath.join(directory, `${name}-brain`)))) return null;
          return { name, path: await realPathOrSelf(directory) };
        }),
    )
  )
    .filter((profile): profile is FilesystemCodeProfile => profile !== null)
    .toSorted((left, right) => left.name.localeCompare(right.name));

  const assignments = await Promise.all(
    input.paths.map(async (path) => {
      const realPath = await realPathOrSelf(path);
      const profile = profiles.find(
        (candidate) =>
          realPath === candidate.path || realPath.startsWith(`${candidate.path}${NodePath.sep}`),
      );
      return { path, profile: profile?.name ?? null };
    }),
  );
  return { profiles, assignments };
}

/**
 * The profile the user's code lives in by default: the one a symlink directly
 * under `~/code` points into (a shared checkout linked out of its profile).
 * With several, the first by name; with none, the first profile. Null when
 * there are no profiles.
 */
export async function resolveDefaultCodeProfile(
  profiles: ReadonlyArray<FilesystemCodeProfile>,
  homeDir: string = NodeOS.homedir(),
): Promise<string | null> {
  const root = NodePath.join(homeDir, CODE_PROFILES_DIRECTORY);
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await NodeFSP.readdir(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const linked = new Set<string>();
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const target = await realPathOrSelf(NodePath.join(root, entry.name));
    const profile = profiles.find((candidate) =>
      target.startsWith(`${candidate.path}${NodePath.sep}`),
    );
    if (profile) linked.add(profile.name);
  }
  const byName = profiles.toSorted((left, right) => left.name.localeCompare(right.name));
  return (byName.find((profile) => linked.has(profile.name)) ?? byName[0])?.name ?? null;
}
