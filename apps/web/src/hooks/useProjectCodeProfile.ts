import type { ServerProvider } from "@t3tools/contracts";

import { projectCodeProfile, serverHomeDirectory } from "../profileGuard.logic";
import { useSpaceStore } from "../spaceStore";

/** The code profile of a project (see `projectCodeProfile`), or null when unknown. */
export function useProjectCodeProfile(input: {
  readonly environmentId: string | null | undefined;
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
  return projectCodeProfile({
    workspaceRoot: input.workspaceRoot,
    detectedProfile,
    overrides: input.projectProfiles ?? {},
    homeDirectory: serverHomeDirectory(input.providers),
  });
}
