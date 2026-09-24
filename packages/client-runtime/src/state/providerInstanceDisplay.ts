/**
 * How a configured provider instance presents itself in a client: its label,
 * its accent color, and whether its icon carries the account badge. Shared by
 * web and mobile so both clients name and badge the same instance identically.
 *
 * @module providerInstanceDisplay
 */
import {
  defaultInstanceIdForDriver,
  type OrchestrationThreadActivity,
  PROVIDER_DISPLAY_NAMES,
  type ProviderConfigDir,
  type ProviderDriverKind,
  type ServerProvider,
  SessionConfigDirObservation,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * Title-case a slug: splits on `_` / `-` and camelCase boundaries, so
 * `codex_personal` becomes "Codex Personal" and `myCustomInstance` becomes
 * "My Custom Instance".
 */
function humanizeSlug(slug: string): string {
  return slug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Resolve an instance's label with a tiered priority:
 *
 *   1. A snapshot `displayName` that differs from the driver's brand label —
 *      the server has explicitly named this instance, trust it.
 *   2. For non-default instances, a humanized `instanceId` — the server fell
 *      back to the driver-level label (the same for every instance of that
 *      kind), so the slug is what keeps "Codex" and "Codex Personal" apart.
 *   3. The snapshot's `displayName`, or the brand label from contracts.
 */
export function resolveProviderInstanceDisplayName(
  snapshot: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
): string {
  const trimmedSnapshotName = snapshot.displayName?.trim();
  const kindLabel = PROVIDER_DISPLAY_NAMES[snapshot.driver] ?? humanizeSlug(snapshot.driver);
  if (trimmedSnapshotName && trimmedSnapshotName !== kindLabel) return trimmedSnapshotName;
  if (snapshot.instanceId !== defaultInstanceIdForDriver(snapshot.driver)) {
    const humanized = humanizeSlug(snapshot.instanceId);
    if (humanized.length > 0) return humanized;
  }
  return trimmedSnapshotName || kindLabel;
}

/**
 * Turn a display name into up to two initials for the badge: the first two
 * characters of a single word, or the first character of each of the first
 * two words. Iterates by code point so an emoji never splits into surrogates.
 */
export function providerInstanceInitials(label: string): string {
  const words = label.replace(/[_-]+/g, " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

/** Only `#rrggbb` accent colors render; anything else is treated as unset. */
export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

/**
 * Whether an instance's icon carries the account badge: accent color set, or
 * several instances sharing a driver so the brand glyph alone is ambiguous.
 * Shared by the composer trigger, the picker rail, and sidebar/thread rows.
 */
export function shouldShowInstanceBadge(
  entry: { readonly driverKind: ProviderDriverKind; readonly accentColor?: string | undefined },
  entries: Iterable<{ readonly driverKind: ProviderDriverKind }>,
): boolean {
  if (entry.accentColor) return true;
  let sharedDriverCount = 0;
  for (const candidate of entries) {
    if (candidate.driverKind === entry.driverKind && ++sharedDriverCount > 1) return true;
  }
  return false;
}

const isSessionConfigDirObservation = Schema.is(SessionConfigDirObservation);

/**
 * The newest config-dir observation a provider session reported for a thread
 * (the dir it was launched with next to the dir the CLI actually used).
 */
export function deriveLatestConfigDirObservation(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SessionConfigDirObservation | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "provider.config-dir") continue;
    if (isSessionConfigDirObservation(activity.payload)) return activity.payload;
  }
  return null;
}

export interface ProviderConfigDirIndicator {
  /**
   * The dir the thread runs on: observed when known, otherwise configured.
   * `null` while the instance leaves the dir to the CLI and no session has
   * reported one yet, since the server's default is only a guess then.
   */
  readonly current: ProviderConfigDir | null;
  readonly configured: ProviderConfigDir;
  /** A wrapper binary sent the CLI to a different dir than configured. */
  readonly redirected: boolean;
}

function sameConfigDir(left: ProviderConfigDir, right: ProviderConfigDir): boolean {
  const trim = (value: string) => value.replace(/(?<=.)[\\/]+$/u, "");
  return trim(left.path) === trim(right.path);
}

/**
 * The config dir an instance launches sessions with in a workspace: a dir the
 * server resolved for that workspace wins, otherwise the instance-level dir,
 * which is only a guess when the instance leaves the dir to the CLI.
 */
export function resolveProviderWorkspaceConfigDir(
  provider: Pick<ServerProvider, "configDir" | "configDirInherited" | "workspaceSnapshots">,
  cwd: string | null | undefined,
): { readonly configured: ProviderConfigDir | undefined; readonly inherited: boolean } {
  const workspaceConfigDir = cwd
    ? provider.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd)?.configDir
    : undefined;
  if (workspaceConfigDir) return { configured: workspaceConfigDir, inherited: false };
  return { configured: provider.configDir, inherited: provider.configDirInherited === true };
}

/**
 * Combine an instance's configured dir with the latest session observation.
 * Instances without a configured dir (drivers that don't report one) get no
 * indicator. An observation made under a different configured dir (another
 * instance, or this instance's homePath changed since) is stale and ignored
 * until the next prompt reports again. When the dir is `inherited` (the
 * instance sets none), nothing was configured, so a differing observed dir is
 * not a redirect.
 */
export function resolveProviderConfigDirIndicator(input: {
  readonly configured: ProviderConfigDir | undefined;
  readonly inherited?: boolean | undefined;
  readonly observation: SessionConfigDirObservation | null;
}): ProviderConfigDirIndicator | null {
  const { configured, observation } = input;
  const inherited = input.inherited === true;
  if (!configured) return null;
  if (observation && sameConfigDir(observation.configured, configured)) {
    return {
      current: observation.effective,
      configured: observation.configured,
      redirected: !inherited && !sameConfigDir(observation.effective, observation.configured),
    };
  }
  return { current: inherited ? null : configured, configured, redirected: false };
}
