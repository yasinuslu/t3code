/**
 * An instance pinned to one code profile's config dir must not run another
 * profile's work. The server refuses such sessions; the web hides them.
 * @module profileGuard
 */
import { COMMON_PROFILE } from "@t3tools/contracts";

export interface ProfileMismatch {
  /** The profile the instance's config dir belongs to. */
  readonly instanceProfile: string;
  /** The profile the project or workspace belongs to. */
  readonly workspaceProfile: string;
}

/**
 * The mismatch between an instance pinned to `instanceProfile` and a workspace
 * of `workspaceProfile`, or undefined when they may run together: either side
 * unknown (no profiles, a folder outside every profile, an instance that picks
 * its dir per workspace), a `common` project, or the same profile.
 */
export function profileMismatch(
  instanceProfile: string | null | undefined,
  workspaceProfile: string | null | undefined,
): ProfileMismatch | undefined {
  if (!instanceProfile || !workspaceProfile) return undefined;
  if (instanceProfile === COMMON_PROFILE || workspaceProfile === COMMON_PROFILE) return undefined;
  return instanceProfile === workspaceProfile ? undefined : { instanceProfile, workspaceProfile };
}

/** The refusal shown when a turn would run on an instance of another profile. */
export function profileMismatchMessage(
  mismatch: ProfileMismatch,
  instanceLabel?: string | undefined,
): string {
  const instance = instanceLabel ? `"${instanceLabel}"` : "This provider instance";
  return (
    `${instance} runs from the ${mismatch.instanceProfile} profile, but this project belongs to ` +
    `the ${mismatch.workspaceProfile} profile. Pick a ${mismatch.workspaceProfile} instance ` +
    `in the model picker; work never runs on another profile's account.`
  );
}
