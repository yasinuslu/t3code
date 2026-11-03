import type { ServerProvider } from "@t3tools/contracts";
import { type ProfileMismatch, profileMismatch } from "@t3tools/shared/profileGuard";

/**
 * The home directory as the server sees it, read off any provider config dir
 * that reports both its absolute path and its `~` form. Null when none does.
 */
export function serverHomeDirectory(providers: ReadonlyArray<ServerProvider>): string | null {
  for (const provider of providers) {
    const dir = provider.configDir;
    if (!dir?.displayPath.startsWith("~/")) continue;
    const suffix = dir.displayPath.slice(1);
    if (dir.path.endsWith(suffix)) return dir.path.slice(0, dir.path.length - suffix.length);
  }
  return null;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * A project's code profile: the deepest `settings.projectProfiles` folder that
 * holds its workspace root (which may say `common`), else the profile the
 * server detected for it, else null.
 */
export function projectCodeProfile(input: {
  readonly workspaceRoot: string | null | undefined;
  readonly detectedProfile: string | null | undefined;
  readonly overrides: Readonly<Record<string, string>>;
  readonly homeDirectory: string | null;
}): string | null {
  const root = input.workspaceRoot;
  if (root) {
    let best: { readonly folder: string; readonly profile: string } | undefined;
    for (const [key, profile] of Object.entries(input.overrides)) {
      const folder = key.startsWith("~/")
        ? input.homeDirectory === null
          ? null
          : `${input.homeDirectory}${key.slice(1)}`
        : key;
      if (folder === null) continue;
      const trimmed = folder.replace(/\/+$/u, "");
      if (isWithin(root, trimmed) && (best === undefined || trimmed.length > best.folder.length)) {
        best = { folder: trimmed, profile };
      }
    }
    if (best !== undefined) return best.profile;
  }
  return input.detectedProfile ?? null;
}

/**
 * Why `provider` may not run a project of `projectProfile`: it is pinned to
 * another profile's config dir. Instances that pick their dir per workspace
 * report no profile and always pass.
 */
export function providerProfileMismatch(
  provider: Pick<ServerProvider, "configDir" | "configDirInherited">,
  projectProfile: string | null | undefined,
): ProfileMismatch | undefined {
  if (provider.configDirInherited === true) return undefined;
  return profileMismatch(provider.configDir?.profile, projectProfile);
}
