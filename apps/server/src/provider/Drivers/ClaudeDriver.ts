/**
 * ClaudeDriver — `ProviderDriver` for the Claude Agent SDK runtime.
 *
 * Mirrors `CodexDriver`: a plain value whose `create()` returns one
 * `ProviderInstance` bundling `snapshot` / `adapter` / `textGeneration`
 * closures captured over the per-instance `ClaudeSettings`.
 *
 * Unlike Codex, the Claude snapshot probe may invoke a secondary probe
 * (`probeClaudeCapabilities`) to read Anthropic account + slash-command
 * metadata. That probe is per-instance and keyed by binary + resolved HOME so
 * two concurrent Claude instances don't cross-contaminate account metadata.
 *
 * @module provider/Drivers/ClaudeDriver
 */
import { ClaudeSettings, ProviderDriverKind } from "@t3tools/contracts";
import type { SlashCommand as ClaudeSlashCommand } from "@anthropic-ai/claude-agent-sdk";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeTextGeneration } from "../../textGeneration/ClaudeTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import * as ProviderEventLoggers from "../Layers/ProviderEventLoggers.ts";
import {
  createClaudeAdapterV2,
  type ClaudeAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as PtyAdapter from "../../terminal/PtyAdapter.ts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { ClaudeProfileLogins } from "../ClaudeProfileLogins.ts";
import { makeClaudeProfileLoginAuth } from "../ClaudeProfileLoginAuth.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeClaudeScopedLimitNames } from "../Layers/claudeUsageLimits.ts";
import * as ClaudeResetCredits from "../Layers/claudeResetCredits.ts";
import * as ResetCreditCoordinator from "../Layers/resetCreditCoordinator.ts";
import {
  checkClaudeCodeProfiles,
  checkClaudeProviderStatus,
  claudeSlashCommands,
  makeClaudeWorkspaceCatalog,
  makePendingClaudeProvider,
  probeClaudeCapabilities,
  probeClaudeWorkspaceSnapshot,
} from "../Layers/ClaudeProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import * as ModelManifest from "../ModelManifest.ts";
import { resolveClaudeModelCatalog } from "../ClaudeModelCatalog.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import {
  describeClaudeConfigDir,
  isClaudeConfigDirInherited,
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";
import { discoverClaudeSkills } from "./ClaudeSkills.ts";
import {
  makeClaudeConfigDirResolver,
  type ResolvedClaudeConfigDir,
} from "./ClaudeConfigDirCommand.ts";
import { CodeProfiles } from "../CodeProfiles.ts";
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

const DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CAPABILITIES_PROBE_TTL = Duration.minutes(5);

function isClaudeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@anthropic-ai/claude-code",
  nativeUpdate: {
    args: ["update"],
    isCommandPath: isClaudeNativeCommandPath,
  },
});

export type ClaudeDriverEnv =
  | ClaudeAdapterV2DriverEnv
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | ResetCreditCoordinator.ResetCreditCoordinator
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ModelManifest.ModelManifest
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig
  | ServerSettings.ServerSettingsService;

export const ClaudeDriver: ProviderDriver<ClaudeSettings, ClaudeDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Claude",
    supportsMultipleInstances: true,
  },
  configSchema: ClaudeSettings,
  defaultConfig: (): ClaudeSettings => decodeClaudeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd } = yield* ServerConfig.ServerConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const resetCreditCoordinator = yield* ResetCreditCoordinator.ResetCreditCoordinator;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const modelCatalog = modelManifest.current.pipe(Effect.map(resolveClaudeModelCatalog));
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const effectiveConfig = {
        ...config,
        enabled,
        binaryPath: expandHomePath(config.binaryPath),
      } satisfies ClaudeSettings;
      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );
      const continuationGroupKey = yield* makeClaudeContinuationGroupKey(
        effectiveConfig,
        processEnv,
      );
      const configDir = yield* resolveClaudeHomePath(effectiveConfig, processEnv);
      const accountConfigPath = yield* ClaudeResetCredits.claudeAccountConfigPath(
        effectiveConfig.homePath.trim() || processEnv.CLAUDE_CONFIG_DIR?.trim()
          ? configDir
          : undefined,
      );
      const codeProfiles = yield* Effect.serviceOption(CodeProfiles);
      const profileLogins = Option.getOrUndefined(yield* Effect.serviceOption(ClaudeProfileLogins));
      const configDirResolver = yield* makeClaudeConfigDirResolver(effectiveConfig, processEnv, {
        codeProfiles: Option.getOrUndefined(codeProfiles),
        logins: profileLogins,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Path.Path, path),
      );
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey,
        configDir: describeClaudeConfigDir(configDir),
        configDirInherited: isClaudeConfigDirInherited(effectiveConfig),
      });

      const scopedLimitNames = yield* makeClaudeScopedLimitNames;
      const workspaceCatalog = yield* makeClaudeWorkspaceCatalog;
      // A session's `/reload-skills` or `/reload-plugins` pushes the new command
      // list; republish that workspace's `/` menu with freshly scanned skills.
      const onCommandsChanged = (input: {
        readonly cwd: string;
        readonly commands: ReadonlyArray<ClaudeSlashCommand>;
        readonly environment: NodeJS.ProcessEnv;
        readonly projectConfigDir: ResolvedClaudeConfigDir | undefined;
      }) =>
        Effect.gen(function* () {
          const [existing, skills, checkedAt] = yield* Effect.all([
            workspaceCatalog.get(input.cwd),
            discoverClaudeSkills(effectiveConfig, input.cwd, input.environment),
            Effect.map(DateTime.now, DateTime.formatIso),
          ]);
          const workspaceConfigDir = input.projectConfigDir
            ? describeClaudeConfigDir(input.projectConfigDir.path, input.projectConfigDir.profile)
            : existing?.configDir;
          yield* workspaceCatalog.upsert({
            cwd: input.cwd,
            checkedAt,
            slashCommands: claudeSlashCommands(input.commands),
            skills,
            ...(workspaceConfigDir ? { configDir: workspaceConfigDir } : {}),
          });
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );
      const orchestrationAdapter = yield* createClaudeAdapterV2(
        {
          instanceId,
          displayName,
          accentColor,
          environment,
          enabled,
          config,
        },
        {
          scopedLimitNames,
          onUsageLimits: (update) => snapshot.applyUsageLimits(update),
          onCommandsChanged,
          ...(configDirResolver ? { configDirResolver } : {}),
        },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to build Claude orchestration adapter.",
              cause,
            }),
        ),
      );
      const textGeneration = yield* makeClaudeTextGeneration(
        effectiveConfig,
        processEnv,
        modelCatalog,
        configDirResolver,
      );

      // Per-instance capabilities cache: keyed on binary + resolved HOME so
      // account-specific probes never share auth metadata across instances.
      const capabilitiesProbeCache = yield* Cache.make({
        capacity: 1,
        timeToLive: CAPABILITIES_PROBE_TTL,
        lookup: () =>
          probeClaudeCapabilities(effectiveConfig, processEnv, cwd).pipe(
            Effect.provideService(Path.Path, path),
          ),
      });
      const capabilitiesCacheKey = yield* makeClaudeCapabilitiesCacheKey(
        effectiveConfig,
        cwd,
        processEnv,
      );

      // An instance without its own config dir picks one per thread from the
      // code profiles, so its snapshot also reports each profile's account.
      const folderProfiles =
        effectiveConfig.homePath.trim().length === 0
          ? Option.getOrUndefined(codeProfiles)
          : undefined;
      const attachCodeProfiles = <Snapshot extends { readonly installed: boolean }>(
        snapshot: Snapshot,
      ) =>
        folderProfiles === undefined || !effectiveConfig.enabled
          ? Effect.succeed(snapshot)
          : folderProfiles.list.pipe(
              Effect.flatMap((profiles) =>
                Effect.forEach(profiles, (profile) =>
                  Effect.gen(function* () {
                    const stored = new Map<string, { token: string; expiresAt?: string }>();
                    for (const login of profile.claudeLogins) {
                      const read = profileLogins
                        ? Option.getOrUndefined(yield* profileLogins.read(login.id))
                        : undefined;
                      if (read)
                        stored.set(login.id, {
                          token: read.token,
                          ...(read.expiresAt ? { expiresAt: read.expiresAt } : {}),
                        });
                    }
                    const active = profile.claudeLogin;
                    return {
                      ...profile,
                      savedLogins: profile.claudeLogins.map(({ id }) => {
                        const token = stored.get(id);
                        if (!token) return { id, missing: true as const };
                        return { id, ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}) };
                      }),
                      ...(active
                        ? {
                            login: {
                              ...active,
                              token: stored.get(active.id)?.token,
                              expiresAt: stored.get(active.id)?.expiresAt,
                            },
                          }
                        : {}),
                    };
                  }),
                ),
              ),
              Effect.flatMap((profiles) =>
                checkClaudeCodeProfiles(
                  profiles,
                  (profileEnvironment, root) =>
                    snapshot.installed
                      ? fileSystem.exists(root).pipe(
                          Effect.orElseSucceed(() => false),
                          Effect.flatMap((rootExists) =>
                            probeClaudeCapabilities(
                              effectiveConfig,
                              profileEnvironment,
                              rootExists ? root : cwd,
                              false,
                            ),
                          ),
                          Effect.provideService(Path.Path, path),
                        )
                      : Effect.succeed(undefined),
                  processEnv,
                ),
              ),
              Effect.map((profiles) => ({ ...snapshot, codeProfiles: profiles })),
            );

      // Start the TTL-gated refresh without delaying provider readiness. The
      // next check observes a remote manifest after the background fetch lands.
      const checkProvider = modelManifest.refreshInBackground.pipe(
        Effect.andThen(
          modelManifest.current.pipe(
            Effect.flatMap((manifest) =>
              checkClaudeProviderStatus(
                effectiveConfig,
                () => Cache.get(capabilitiesProbeCache, capabilitiesCacheKey),
                processEnv,
                cwd,
                resolveClaudeModelCatalog(manifest),
                scopedLimitNames,
                (version) =>
                  ClaudeResetCredits.readClaudeResetCredits(configDir, version).pipe(
                    Effect.provideService(HttpClient.HttpClient, httpClient),
                    Effect.provideService(FileSystem.FileSystem, fileSystem),
                    Effect.provideService(Path.Path, path),
                  ),
              ),
            ),
            Effect.map(stampIdentity),
            Effect.flatMap(attachCodeProfiles),
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings, {
        includeCodeProfiles: folderProfiles !== undefined,
      });
      const managedSnapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<ClaudeSettings>
      >({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          modelManifest.current.pipe(
            Effect.flatMap((manifest) =>
              makePendingClaudeProvider(settings.provider, resolveClaudeModelCatalog(manifest)),
            ),
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
          resolveMaintenance().pipe(
            Effect.flatMap((maintenanceCapabilities) =>
              enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              }),
            ),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Claude snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const snapshot = workspaceCatalog.wrap(managedSnapshot);
      const snapshotForCwd = (
        cwd: string,
        context?: { readonly projectRoot?: string | undefined },
      ) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.gen(function* () {
              const projectConfigDir = configDirResolver
                ? yield* configDirResolver.resolveForWorkspace(cwd, context?.projectRoot)
                : undefined;
              const [machineSnapshot, live] = yield* Effect.all([
                snapshot.getSnapshot,
                workspaceCatalog.get(cwd),
              ]);
              // Probe with the workspace's own config dir, so its commands and
              // skills come from the profile that the session will run with.
              const probed = yield* probeClaudeWorkspaceSnapshot(
                effectiveConfig,
                machineSnapshot,
                cwd,
                configDirResolver
                  ? yield* configDirResolver.environmentFor(projectConfigDir, processEnv)
                  : processEnv,
              );
              const { skills } = probed;
              // A probe that could not finish keeps the list a live session reported.
              const slashCommands =
                probed.slashCommandsPending && live ? live.slashCommands : probed.slashCommands;
              const slashCommandsPending = probed.slashCommandsPending && !live;
              const workspaceConfigDir = projectConfigDir
                ? describeClaudeConfigDir(projectConfigDir.path, projectConfigDir.profile)
                : undefined;
              if (!slashCommandsPending) {
                yield* workspaceCatalog.upsert({
                  cwd,
                  checkedAt: machineSnapshot.checkedAt,
                  slashCommands,
                  skills,
                  ...(workspaceConfigDir ? { configDir: workspaceConfigDir } : {}),
                });
              }
              if (!workspaceConfigDir) {
                return { ...machineSnapshot, slashCommands, slashCommandsPending, skills };
              }
              const { configDirInherited: _inherited, ...explicitSnapshot } = machineSnapshot;
              return {
                ...explicitSnapshot,
                slashCommands,
                slashCommandsPending,
                skills,
                configDir: workspaceConfigDir,
              };
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
            );

      // Same rules as Codex: serialised on the config directory that holds the
      // login, one request id kept until Claude answers (a cooldown or rate
      // limit is an answer), then a re-probe.
      const consumeResetCredit: NonNullable<ProviderInstance["consumeResetCredit"]> = () =>
        Effect.gen(function* () {
          const current = yield* snapshot.getSnapshot;
          const grantId = current.usageLimits?.resetCredits?.nextCreditId;
          if (!grantId || !current.version) return "noCredit" as const;
          const version = current.version;
          return yield* resetCreditCoordinator.redeem(
            configDir,
            (requestId) =>
              ClaudeResetCredits.consumeClaudeResetCredit({
                configDir,
                accountConfigPath,
                version,
                grantId,
                requestId,
              }),
            ClaudeResetCredits.isSettledClaudeResetCreditFailure,
          );
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: DRIVER_KIND,
                instanceId,
                detail:
                  cause._tag === "ClaudeResetCreditError"
                    ? cause.message
                    : "Claude could not redeem the reset.",
                cause,
              }),
          ),
          // Re-probe after any answer, but only a reset claims the limits
          // changed, so only a reset reports an unconfirmed refresh.
          Effect.tap((outcome) =>
            Effect.gen(function* () {
              const before = (yield* snapshot.getSnapshot).usageLimits?.checkedAt;
              yield* Cache.invalidateAll(capabilitiesProbeCache);
              const refreshed = yield* snapshot.refresh;
              const after = refreshed.usageLimits?.checkedAt;
              if (
                outcome === "reset" &&
                (after === undefined ||
                  after === before ||
                  refreshed.usageLimits?.unavailable?.reason === "probeFailed")
              ) {
                return yield* new ProviderDriverError({
                  driver: DRIVER_KIND,
                  instanceId,
                  detail:
                    "The reset was applied, but Claude could not confirm the new limits. Refresh to check.",
                });
              }
            }),
          ),
        );

      // The routing instance is where a profile's token logins are added.
      const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
      const setupTokenCommand = yield* resolveSpawnCommand(
        effectiveConfig.binaryPath,
        ["setup-token"],
        { env: processEnv },
      );
      const auth =
        folderProfiles !== undefined && profileLogins !== undefined
          ? yield* makeClaudeProfileLoginAuth({
              instanceId,
              settings: serverSettings,
              logins: profileLogins,
              pty,
              setupTokenCommand,
              environment: processEnv,
              cwd,
            })
          : undefined;

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        ...(auth ? { auth } : {}),
        continuationIdentity: {
          ...fallbackContinuationIdentity,
          continuationKey: continuationGroupKey,
        },
        displayName,
        accentColor,
        enabled,
        snapshot,
        invalidateCaches: Effect.andThen(
          Cache.invalidateAll(capabilitiesProbeCache),
          configDirResolver?.invalidate ?? Effect.void,
        ),
        snapshotForCwd,
        orchestrationAdapter,
        textGeneration,
        consumeResetCredit,
      } satisfies ProviderInstance;
    }),
};
