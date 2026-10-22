// @effect-diagnostics nodeBuiltinImport:off
/**
 * ProfileVisibility - which projects a profile-locked client may see.
 *
 * A project's profile is the code profile its path sits in (see
 * `resolveCodeProfiles`), unless `settings.projectProfiles` names one of its
 * folders: the deepest such folder wins, and its value is a profile name or
 * `common`. A client that connects with a profile lock (`clientProfile` on the
 * socket, `x-t3-client-profile` over HTTP) sees that profile's projects, the
 * common ones, and projects outside every profile; the server leaves every
 * other project and its threads out of what it answers on that connection.
 *
 * @module workspace/ProfileVisibility
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import { COMMON_PROFILE, type OrchestrationProjectShell } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import { resolveCodeProfiles } from "./CodeProfiles.ts";

const MAX_PROFILE_NAME_LENGTH = 64;

/** A profile lock as a client sent it; blank or oversized values mean no lock. */
export function parseProfileLock(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || trimmed.length > MAX_PROFILE_NAME_LENGTH ? null : trimmed;
}

/** Whether a project of `profile` (null: outside every profile) shows under `lock`. */
export function isProfileVisible(profile: string | null, lock: string | null): boolean {
  return lock === null || profile === null || profile === COMMON_PROFILE || profile === lock;
}

async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await NodeFSP.realpath(path);
  } catch {
    return path;
  }
}

function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return NodePath.join(homeDir, path.slice(2));
  return path;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${NodePath.sep}`);
}

/**
 * The profile of each path: the deepest `overrides` folder containing it,
 * else the code profile it sits in, else null.
 */
export async function resolveProjectProfiles(
  paths: ReadonlyArray<string>,
  overrides: Readonly<Record<string, string>>,
  homeDir: string = NodeOS.homedir(),
): Promise<ReadonlyArray<string | null>> {
  const roots = await Promise.all(
    Object.entries(overrides).map(async ([folder, profile]) => ({
      root: await realPathOrSelf(NodePath.resolve(expandHome(folder, homeDir))),
      profile,
    })),
  );
  const { assignments } = await resolveCodeProfiles({ paths: [...paths] }, homeDir);
  return Promise.all(
    paths.map(async (path, index) => {
      const real = await realPathOrSelf(path);
      let best: { readonly root: string; readonly profile: string } | undefined;
      for (const candidate of roots) {
        if (
          (isWithin(real, candidate.root) || isWithin(path, candidate.root)) &&
          (best === undefined || candidate.root.length > best.root.length)
        ) {
          best = candidate;
        }
      }
      return best?.profile ?? assignments[index]?.profile ?? null;
    }),
  );
}

export class ProfileVisibility extends Context.Service<
  ProfileVisibility,
  {
    /** The profile of each project, by project id. */
    readonly profilesOf: (
      projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "workspaceRoot">>,
    ) => Effect.Effect<ReadonlyMap<string, string | null>>;
    /** Ids of the projects `lock` may see; every id when there is no lock. */
    readonly visibleProjectIds: (
      lock: string | null,
      projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "workspaceRoot">>,
    ) => Effect.Effect<ReadonlySet<string>>;
  }
>()("t3/workspace/ProfileVisibility") {}

export const make = Effect.gen(function* () {
  // Optional so transports built without settings (tests) keep working.
  const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const overrides =
    serverSettings._tag === "None"
      ? Effect.succeed<Readonly<Record<string, string>>>({})
      : serverSettings.value.getSettings.pipe(
          Effect.map((settings) => settings.projectProfiles),
          Effect.orElseSucceed((): Readonly<Record<string, string>> => ({})),
        );

  const profilesOf: ProfileVisibility["Service"]["profilesOf"] = (projects) =>
    Effect.gen(function* () {
      const folders = yield* overrides;
      const profiles = yield* Effect.promise(() =>
        resolveProjectProfiles(
          projects.map((project) => project.workspaceRoot),
          folders,
        ),
      );
      return new Map(
        projects.map((project, index) => [project.id as string, profiles[index] ?? null]),
      );
    });

  const visibleProjectIds: ProfileVisibility["Service"]["visibleProjectIds"] = (lock, projects) =>
    lock === null
      ? Effect.succeed(new Set(projects.map((project) => project.id as string)))
      : profilesOf(projects).pipe(
          Effect.map(
            (profiles) =>
              new Set(
                projects
                  .filter((project) => isProfileVisible(profiles.get(project.id) ?? null, lock))
                  .map((project) => project.id as string),
              ),
          ),
        );

  return ProfileVisibility.of({ profilesOf, visibleProjectIds });
});

export const layer = Layer.effect(ProfileVisibility, make);

type ProjectRef = Pick<OrchestrationProjectShell, "id" | "workspaceRoot">;
type ThreadRef = { readonly id: string; readonly projectId: string };

interface ShellSnapshotLike {
  readonly projects: ReadonlyArray<ProjectRef>;
  readonly threads: ReadonlyArray<ThreadRef>;
  readonly archivedThreads?: ReadonlyArray<ThreadRef>;
}

type ShellItemLike =
  | { readonly kind: "synchronized" }
  | {
      readonly kind: "snapshot";
      readonly snapshot: ShellSnapshotLike;
      readonly resolvedRepositoryIdentityRoots?: ReadonlyArray<string>;
    }
  | { readonly kind: "project.updated"; readonly sequence: number; readonly project: ProjectRef }
  | { readonly kind: "project.removed"; readonly sequence: number; readonly projectId: string }
  | {
      readonly kind: "thread.updated";
      readonly sequence: number;
      readonly location?: "active" | "archive";
      readonly thread: ThreadRef;
    }
  | {
      readonly kind: "thread.removed";
      readonly sequence: number;
      readonly location?: "active" | "archive";
      readonly threadId: string;
    };

/**
 * A per-connection filter over shell stream items for a profile lock. It
 * remembers which projects it has judged, so a thread update costs one map
 * lookup, and turns an update of something the lock hides into a removal, so
 * a client that cached it before the lock drops it.
 */
export const makeShellItemFilter = Effect.fn("ProfileVisibility.makeShellItemFilter")(function* (
  lock: string | null,
  lookupProject: (projectId: string) => Effect.Effect<ProjectRef | null>,
) {
  const visibility = yield* ProfileVisibility;
  const known = new Map<string, boolean>();

  const judge = Effect.fnUntraced(function* (projects: ReadonlyArray<ProjectRef>) {
    const visible = yield* visibility.visibleProjectIds(lock, projects);
    for (const project of projects) known.set(project.id, visible.has(project.id));
  });

  const isProjectVisible = Effect.fnUntraced(function* (projectId: string) {
    const cached = known.get(projectId);
    if (cached !== undefined) return cached;
    const project = yield* lookupProject(projectId);
    if (project === null) return false;
    yield* judge([project]);
    return known.get(projectId) ?? false;
  });

  const filterSnapshot = Effect.fnUntraced(function* <S extends ShellSnapshotLike>(snapshot: S) {
    if (lock === null) return snapshot;
    yield* judge(snapshot.projects);
    const keepThreads = <T extends ThreadRef>(threads: ReadonlyArray<T>) =>
      Effect.filter(threads, (thread) => isProjectVisible(thread.projectId));
    return {
      ...snapshot,
      projects: snapshot.projects.filter((project) => known.get(project.id) === true),
      threads: yield* keepThreads(snapshot.threads),
      ...(snapshot.archivedThreads === undefined
        ? {}
        : { archivedThreads: yield* keepThreads(snapshot.archivedThreads) }),
    } as S;
  });

  const filterItem = Effect.fnUntraced(function* <I extends ShellItemLike>(item: I) {
    if (lock === null) return item;
    switch (item.kind) {
      case "snapshot": {
        const snapshot = yield* filterSnapshot(item.snapshot);
        // An enrichment refresh also names the roots it resolved; keep only visible ones.
        const roots = item.resolvedRepositoryIdentityRoots;
        if (roots === undefined) return { ...item, snapshot } as I;
        const visibleRoots = new Set(snapshot.projects.map((project) => project.workspaceRoot));
        return {
          ...item,
          snapshot,
          resolvedRepositoryIdentityRoots: roots.filter((root) => visibleRoots.has(root)),
        } as I;
      }
      case "project.updated": {
        yield* judge([item.project]);
        return known.get(item.project.id) === true
          ? item
          : ({
              kind: "project.removed",
              sequence: item.sequence,
              projectId: item.project.id,
            } as unknown as I);
      }
      case "thread.updated": {
        if (yield* isProjectVisible(item.thread.projectId)) return item;
        return {
          kind: "thread.removed",
          sequence: item.sequence,
          ...(item.location === undefined ? {} : { location: item.location }),
          threadId: item.thread.id,
        } as unknown as I;
      }
      default:
        return item;
    }
  });

  return { filterSnapshot, filterItem, isProjectVisible };
});
