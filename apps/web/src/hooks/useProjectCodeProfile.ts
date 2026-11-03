import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";

import { projectCodeProfile, serverHomeDirectory } from "../profileGuard.logic";
import { useSpaceStore } from "../spaceStore";
import { filesystemEnvironment } from "../state/filesystem";
import { useEnvironmentQuery } from "../state/query";

/**
 * The code profile of a project, or null when unknown. Prefers the server's
 * answer (symlinks resolved, `settings.projectProfiles` applied); older
 * servers fall back to `projectCodeProfile`.
 */
export function useProjectCodeProfile(input: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly projectId: string | null | undefined;
  readonly workspaceRoot: string | null | undefined;
  readonly projectProfiles: Readonly<Record<string, string>> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
}): string | null {
  const key =
    input.environmentId && input.projectId ? `${input.environmentId}:${input.projectId}` : null;
  const detectedProfile = useSpaceStore((store) =>
    key === null ? null : (store.detectedProfileByProjectKey[key] ?? null),
  );
  const query = useEnvironmentQuery(
    input.environmentId && input.workspaceRoot
      ? filesystemEnvironment.codeProfiles({
          environmentId: input.environmentId,
          input: { paths: [input.workspaceRoot] },
        })
      : null,
  );
  const effective = query.data?.assignments[0]?.effectiveProfile;
  if (effective !== undefined) return effective;
  return projectCodeProfile({
    workspaceRoot: input.workspaceRoot,
    detectedProfile,
    overrides: input.projectProfiles ?? {},
    homeDirectory: serverHomeDirectory(input.providers),
  });
}
