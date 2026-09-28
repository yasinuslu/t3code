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
