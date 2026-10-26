import {
  defaultInstanceIdForDriver,
  type OrchestrationV2ProviderSessionConfigDir,
  PROVIDER_DISPLAY_NAMES,
  type ProviderConfigDir,
  type ProviderDriverKind,
  type ServerProvider,
  type SessionConfigDirObservation,
} from "@t3tools/contracts";

function humanizeSlug(slug: string): string {
  return slug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

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

export function providerInstanceInitials(label: string): string {
  // Punctuation separates words so "Codex (hub)" reads CH, not C(. An apostrophe
  // inside a word stays ("Theo's Codex" is TC); a quoting one does not
  // ("Codex 'hub'" is CH).
  const words = label
    .replace(/[^\P{P}'’]+/gu, " ")
    .split(/\s+/u)
    .map((word) => word.replace(/^['’]+|['’]+$/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

export function providerAccentForegroundColor(accentColor: string) {
  const linearChannel = (offset: number) => {
    const value = Number.parseInt(accentColor.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export function shouldShowInstanceBadge(
  entry: {
    readonly driverKind: ProviderDriverKind;
    readonly accentColor?: string | undefined;
    readonly acpRegistryAgentId?: string | undefined;
    readonly enabled: boolean;
  },
  entries: Iterable<{
    readonly driverKind: ProviderDriverKind;
    readonly acpRegistryAgentId?: string | undefined;
    readonly enabled: boolean;
  }>,
): boolean {
  if (entry.accentColor) return true;
  let sharedProviderCount = 0;
  for (const candidate of entries) {
    if (candidate.driverKind !== entry.driverKind) continue;
    // Historical threads still need to distinguish accounts that are all disabled.
    if (entry.enabled && !candidate.enabled) continue;
    if (
      entry.driverKind === "acpRegistry" &&
      candidate.acpRegistryAgentId !== entry.acpRegistryAgentId
    ) {
      continue;
    }
    if (++sharedProviderCount > 1) return true;
  }
  return false;
}

/**
 * The config-dir observation of a thread's provider session: the dir it was
 * launched with next to the dir the CLI reported using. `null` until the CLI
 * reported one (it does on each prompt), or when there is no session.
 */
export function deriveSessionConfigDirObservation(
  session:
    | { readonly configDir?: OrchestrationV2ProviderSessionConfigDir | undefined }
    | null
    | undefined,
): SessionConfigDirObservation | null {
  const configDir = session?.configDir;
  if (configDir?.effective === undefined) return null;
  return { configured: configDir.configured, effective: configDir.effective };
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
      // The workspace's dir: same path, but it carries the current code profile label,
      // which a session started before code profiles never recorded.
      configured,
      redirected: !inherited && !sameConfigDir(observation.effective, observation.configured),
    };
  }
  return { current: inherited ? null : configured, configured, redirected: false };
}
