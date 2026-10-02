// @effect-diagnostics nodeBuiltinImport:off
/**
 * Brainstorm: one agent chat per space, working in the space's knowledge base
 * ("brain") repository, with a markdown task list kept in that repository.
 *
 * Where things live:
 * - A profile space `p` works in `~/code/p/p-brain` and keeps its tasks in
 *   `~/code/p/p-brain/tasks.md`.
 * - Custom spaces and Other work in the default profile's brain and keep
 *   their tasks in `<default brain>/tasks/<space-name-slug>.md`.
 * - All works in the default profile's brain and sees every list.
 *
 * The default profile is the one the client picked, else the profile a
 * symlink directly under `~/code` points into, else the first profile.
 *
 * Spaces live in the client; it mirrors them here (`syncSpaces`) so the
 * agent's tools can be scoped to its space. Which thread is a space's
 * brainstorm, and the last mirrored spaces, persist in `brainstorm.json` in
 * the state directory.
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  type BrainstormMutateTasksInput,
  type BrainstormOpenResult,
  BrainstormSpace,
  BrainstormState,
  type BrainstormSyncSpacesInput,
  type BrainstormTaskList,
  BrainstormError,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { setThreadInstructions } from "../provider/RuntimeInstructions.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveCodeProfiles, resolveDefaultCodeProfile } from "../workspace/CodeProfiles.ts";
import {
  addTask,
  deleteTask,
  parseTaskMarkdown,
  TaskAmbiguousError,
  TaskNotFoundError,
  updateTask,
} from "./taskMarkdown.ts";
import {
  completeSettledTasks,
  isSettledAfterSuccess,
  makeTurnEndTracker,
} from "./taskAutoComplete.ts";

export const ALL_SPACE_ID = "all";

function allBrainstormThreadIds(state: {
  readonly threadIdsBySpaceId: Readonly<Record<string, string>>;
  readonly threadIdsBySpaceBrain?: Readonly<Record<string, string>> | undefined;
}): ReadonlySet<string> {
  return new Set([
    ...Object.values(state.threadIdsBySpaceId),
    ...Object.values(state.threadIdsBySpaceBrain ?? {}),
  ]);
}
export const OTHER_SPACE_ID = "other";

/**
 * System instructions for brainstorm threads: a fast front desk that hands
 * heavy work to background agents and stays free for the next message.
 */
export const BRAINSTORM_INSTRUCTIONS = `<brainstorm_front_desk>
This thread is a brainstorm chat, the user's front desk. Keep it fast and free.
- Reply in a few short lines. Do a lookup yourself only when it takes a few seconds (a file read, one t3-code tool call).
- Hand anything heavier (research, reading many files, sweeps over threads or repositories) to a background subagent: call the Agent tool with run_in_background set to true, say in one line what you sent, and end your turn. Never wait for it in the foreground.
- Do not make code changes here. Start a thread for them with the t3-code start_thread tool (with task when one fits), name the thread you started, and end your turn.
- When a background agent finishes, relay its result in two lines. Give more only when asked.
- If a manager skill is available, use it for "what's open", "what needs me" and "is X done" questions.
</brainstorm_front_desk>`;

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
/** Fast Claude models for the brainstorm chat, best first. */
const FAST_BRAINSTORM_MODELS = ["claude-sonnet-5-5", "claude-sonnet-5"] as const;

/**
 * Claude Sonnet at low effort on an enabled Claude instance, preferring the
 * one `preferred` uses; null when no Claude instance offers it.
 */
export function fastBrainstormModelSelection(
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "enabled" | "models">>,
  preferred: ModelSelection,
): ModelSelection | null {
  const claude = providers.filter(
    (provider) => provider.driver === CLAUDE_DRIVER && provider.enabled,
  );
  const ordered = [
    ...claude.filter((provider) => provider.instanceId === preferred.instanceId),
    ...claude.filter((provider) => provider.instanceId !== preferred.instanceId),
  ];
  for (const provider of ordered) {
    const model = FAST_BRAINSTORM_MODELS.find((slug) =>
      provider.models.some((candidate) => candidate.slug === slug),
    );
    if (model) {
      return { instanceId: provider.instanceId, model, options: [{ id: "effort", value: "low" }] };
    }
  }
  return null;
}

const PersistedBrainstorm = Schema.Struct({
  spaces: Schema.Array(BrainstormSpace),
  customSpaceIdsByProjectId: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  threadIdsBySpaceId: Schema.Record(Schema.String, Schema.String),
  /**
   * Every brainstorm thread by `${spaceId}|${projectId}`: switching a space
   * to another brain and back returns to the same conversation.
   */
  threadIdsBySpaceBrain: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  defaultProfile: Schema.optional(Schema.NullOr(Schema.String)),
});
type PersistedBrainstorm = typeof PersistedBrainstorm.Type;
const PersistedBrainstormJson = Schema.fromJsonString(PersistedBrainstorm);
const decodePersisted = Schema.decodeUnknownOption(PersistedBrainstormJson);
const encodePersisted = Schema.encodeSync(PersistedBrainstormJson);
const encodeState = Schema.encodeSync(Schema.fromJsonString(BrainstormState));

const EMPTY: PersistedBrainstorm = {
  spaces: [
    { id: ALL_SPACE_ID, name: "All", kind: "all", profile: null },
    { id: OTHER_SPACE_ID, name: "Other", kind: "other", profile: null },
  ],
  customSpaceIdsByProjectId: {},
  threadIdsBySpaceId: {},
};

/** File-name-safe form of a space name. */
export function spaceSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "space"
  );
}

export interface BrainstormProfile {
  readonly name: string;
  /** Real path of `~/code/<name>`. */
  readonly path: string;
  readonly brainPath: string;
}

/** Everything a scope decision needs, read once per request. */
export interface BrainstormContext {
  readonly spaces: ReadonlyArray<BrainstormSpace>;
  readonly profiles: ReadonlyArray<BrainstormProfile>;
  readonly defaultProfile: BrainstormProfile | null;
  readonly threadIdsBySpaceId: Readonly<Record<string, string>>;
  /** Every brainstorm thread, current or not; none of them is a work thread. */
  readonly brainstormThreadIds: ReadonlySet<string>;
  readonly customSpaceIdsByProjectId: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Code profile of each project, by project id. */
  readonly profileByProjectId: ReadonlyMap<string, string | null>;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
}

/** The brain a space's chat works in. */
export function brainPathOf(context: BrainstormContext, space: BrainstormSpace): string | null {
  if (space.kind === "profile") {
    return context.profiles.find((profile) => profile.name === space.profile)?.brainPath ?? null;
  }
  return context.defaultProfile?.brainPath ?? null;
}

/** The markdown file a space keeps its tasks in; All has none of its own. */
export function taskPathOf(context: BrainstormContext, space: BrainstormSpace): string | null {
  if (space.kind === "all") return null;
  const brain = brainPathOf(context, space);
  if (brain === null) return null;
  return space.kind === "profile"
    ? NodePath.join(brain, "tasks.md")
    : NodePath.join(brain, "tasks", `${spaceSlug(space.name)}.md`);
}

/** The home space of a project: its profile's space, else Other. */
export function homeSpaceIdOf(context: BrainstormContext, projectId: string): string {
  const profile = context.profileByProjectId.get(projectId) ?? null;
  const space = profile
    ? context.spaces.find(
        (candidate) => candidate.kind === "profile" && candidate.profile === profile,
      )
    : undefined;
  return space?.id ?? OTHER_SPACE_ID;
}

/** Spaces a project shows in besides All: its home space and custom memberships. */
export function spaceIdsOfProject(context: BrainstormContext, projectId: string): string[] {
  const custom = (context.customSpaceIdsByProjectId[projectId] ?? []).filter((spaceId) =>
    context.spaces.some((space) => space.id === spaceId && space.kind === "custom"),
  );
  return [homeSpaceIdOf(context, projectId), ...custom];
}

export function isProjectInSpace(
  context: BrainstormContext,
  projectId: string,
  spaceId: string,
): boolean {
  return spaceId === ALL_SPACE_ID || spaceIdsOfProject(context, projectId).includes(spaceId);
}

/** A space by id or (case-insensitive) name. */
export function findSpace(
  context: Pick<BrainstormContext, "spaces">,
  reference: string,
): BrainstormSpace | undefined {
  const wanted = reference.trim().toLowerCase();
  return (
    context.spaces.find((space) => space.id === reference) ??
    context.spaces.find((space) => space.name.toLowerCase() === wanted) ??
    context.spaces.find((space) => space.profile?.toLowerCase() === wanted)
  );
}

const describeTaskError = (cause: unknown): string =>
  cause instanceof TaskNotFoundError || cause instanceof TaskAmbiguousError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : String(cause);

export class BrainstormService extends Context.Service<
  BrainstormService,
  {
    readonly syncSpaces: (input: BrainstormSyncSpacesInput) => Effect.Effect<void>;
    readonly open: (spaceId: string) => Effect.Effect<BrainstormOpenResult, BrainstormError>;
    readonly mutateTasks: (
      input: BrainstormMutateTasksInput,
    ) => Effect.Effect<void, BrainstormError>;
    /** Current state first, then every change. */
    readonly stateChanges: Stream.Stream<BrainstormState>;
    readonly context: Effect.Effect<BrainstormContext, BrainstormError>;
    /** The space whose brainstorm this thread is. */
    readonly spaceOfThread: (threadId: string) => Effect.Effect<BrainstormSpace | null>;
    readonly readTaskList: (
      context: BrainstormContext,
      space: BrainstormSpace,
    ) => Effect.Effect<BrainstormTaskList>;
    /**
     * Re-reads a space's task file, applies `edit` to its text and writes the
     * result back, one edit at a time. `edit` throws to reject the change.
     */
    readonly editTasks: <A>(
      context: BrainstormContext,
      space: BrainstormSpace,
      edit: (text: string) => { readonly text: string; readonly result: A },
    ) => Effect.Effect<A, BrainstormError>;
    /** Adds a project to a custom space or removes it; clients adopt the change. */
    readonly setProjectInCustomSpace: (
      projectId: string,
      spaceId: string,
      member: boolean,
    ) => Effect.Effect<void, BrainstormError>;
  }
>()("t3/brainstorm/BrainstormService") {}

const readTextOrEmpty = (path: string) =>
  Effect.promise(() => NodeFSP.readFile(path, "utf8").catch(() => ""));

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projectService = yield* ProjectService.ProjectService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry);
  const crypto = yield* Crypto.Crypto;
  const statePath = NodePath.join(config.stateDir, "brainstorm.json");

  const persistedText = yield* readTextOrEmpty(statePath);
  const persisted = Option.match(decodePersisted(persistedText), {
    onNone: () => EMPTY,
    onSome: (value) => (value.spaces.length > 0 ? value : { ...value, spaces: EMPTY.spaces }),
  });
  const stateRef = yield* Ref.make(persisted);
  // Every brainstorm thread, current or not, starts its sessions as a front desk.
  const registerInstructions = (state: PersistedBrainstorm) => {
    for (const threadId of allBrainstormThreadIds(state)) {
      setThreadInstructions(threadId, BRAINSTORM_INSTRUCTIONS);
    }
  };
  registerInstructions(persisted);
  const membershipRevision = yield* Ref.make(0);
  const writeLock = yield* Semaphore.make(1);
  const openLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<void>(16);

  const save = Ref.get(stateRef).pipe(
    Effect.tap((state) => Effect.sync(() => registerInstructions(state))),
    Effect.flatMap((state) =>
      Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(statePath), { recursive: true });
        const temp = `${statePath}.${process.pid}.tmp`;
        await NodeFSP.writeFile(temp, `${encodePersisted(state)}\n`);
        await NodeFSP.rename(temp, statePath);
      }),
    ),
    Effect.catchCause((cause) => Effect.logWarning("could not save brainstorm state", { cause })),
  );
  const notify = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const context: BrainstormService["Service"]["context"] = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const projects = yield* projectService
      .listShells()
      .pipe(
        Effect.mapError(() => new BrainstormError({ message: "Could not read the projects." })),
      );
    const resolved = yield* Effect.promise(() =>
      resolveCodeProfiles({ paths: projects.map((project) => project.workspaceRoot) }),
    );
    const profiles = resolved.profiles.map((profile) => ({
      name: profile.name,
      path: profile.path,
      brainPath: NodePath.join(profile.path, `${profile.name}-brain`),
    }));
    // The client's pick wins; otherwise the profile the user's code is linked into.
    const fallbackProfile = yield* Effect.promise(() =>
      resolveDefaultCodeProfile(resolved.profiles),
    );
    const defaultProfile =
      profiles.find((profile) => profile.name === state.defaultProfile) ??
      profiles.find((profile) => profile.name === fallbackProfile) ??
      null;
    const profileByProjectId = new Map(
      projects.map((project, index) => [
        project.id as string,
        resolved.assignments[index]?.profile ?? null,
      ]),
    );
    return {
      spaces: state.spaces,
      profiles,
      defaultProfile,
      threadIdsBySpaceId: state.threadIdsBySpaceId,
      brainstormThreadIds: allBrainstormThreadIds(state),
      customSpaceIdsByProjectId: state.customSpaceIdsByProjectId,
      profileByProjectId,
      projects,
    };
  });

  const readTaskList: BrainstormService["Service"]["readTaskList"] = (ctx, space) =>
    Effect.gen(function* () {
      const path = taskPathOf(ctx, space);
      const text = path === null ? "" : yield* readTextOrEmpty(path);
      return {
        spaceId: space.id,
        spaceName: space.name,
        path,
        tasks: parseTaskMarkdown(text).tasks.map(({ number, title, done, notes, threadIds }) => ({
          number,
          title,
          done,
          notes,
          threadIds,
        })),
      };
    });

  const editTasks: BrainstormService["Service"]["editTasks"] = (ctx, space, edit) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const path = taskPathOf(ctx, space);
        if (path === null) {
          return yield* new BrainstormError({
            message:
              space.kind === "all"
                ? "All has no task list of its own. Pass the space whose list to change."
                : `Space ${space.name} has no brain repository to keep tasks in.`,
          });
        }
        // Always edit the file as it is now: it may have been changed by hand.
        const before = yield* readTextOrEmpty(path);
        const outcome = yield* Effect.try({
          try: () => edit(before),
          catch: (cause) => new BrainstormError({ message: describeTaskError(cause) }),
        });
        if (outcome.text !== before) {
          yield* Effect.tryPromise({
            try: async () => {
              await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
              await NodeFSP.writeFile(path, outcome.text);
            },
            catch: () => new BrainstormError({ message: `Could not write ${path}.` }),
          });
          yield* notify;
        }
        return outcome.result;
      }),
    );

  // When a thread's turn ends, check off the tasks it finishes. Runs here, not
  // in a chat, so tasks close whether or not their brainstorm is open.
  const completeTasksOf = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      const paths = new Set<string>();
      for (const space of ctx.spaces) {
        const path = taskPathOf(ctx, space);
        if (path === null || paths.has(path)) continue;
        paths.add(path);
        const list = yield* readTaskList(ctx, space);
        const linked = new Set(
          list.tasks
            .filter((task) => !task.done && task.threadIds.includes(threadId))
            .flatMap((task) => task.threadIds),
        );
        if (linked.size === 0) continue;
        const settled = new Set<string>();
        for (const id of linked) {
          const thread = yield* orchestrator
            .getThreadShell(ThreadId.make(id))
            .pipe(Effect.orElseSucceed(() => null));
          if (isSettledAfterSuccess(thread)) settled.add(id);
        }
        if (settled.size === 0) continue;
        yield* editTasks(ctx, space, (text) => {
          const outcome = completeSettledTasks(text, threadId, (id) => settled.has(id));
          return { text: outcome.text, result: undefined };
        });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("could not complete brainstorm tasks", { threadId, cause }),
      ),
    );
  const turnEnded = makeTurnEndTracker();
  yield* Effect.forkScoped(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
      const threadId = turnEnded(event);
      return threadId === null ? Effect.void : completeTasksOf(threadId);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("brainstorm task auto-complete stopped", { cause }),
      ),
    ),
  );

  const requireSpace = (ctx: BrainstormContext, spaceId: string) => {
    const space = ctx.spaces.find((candidate) => candidate.id === spaceId);
    return space
      ? Effect.succeed(space)
      : Effect.fail(new BrainstormError({ message: `Unknown space ${spaceId}.` }));
  };

  const mutateTasks: BrainstormService["Service"]["mutateTasks"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* context;
      let space = yield* requireSpace(ctx, input.spaceId);
      if (space.kind === "all") {
        // All adds to the default profile's list.
        const fallback = ctx.spaces.find(
          (candidate) =>
            candidate.kind === "profile" && candidate.profile === ctx.defaultProfile?.name,
        );
        if (fallback) space = fallback;
      }
      const mutation = input.mutation;
      const guard = (text: string, number: number, title: string) => {
        const task = parseTaskMarkdown(text).tasks[number - 1];
        // The list may have changed since the client drew it; fall back to the title.
        return task && task.title === title ? number : title;
      };
      yield* editTasks(ctx, space, (text) => {
        switch (mutation.type) {
          case "add":
            return { text: addTask(text, { title: mutation.title }).text, result: undefined };
          case "set-done":
            return {
              text: updateTask(text, guard(text, mutation.number, mutation.title), {
                done: mutation.done,
              }).text,
              result: undefined,
            };
          case "delete":
            return {
              text: deleteTask(text, guard(text, mutation.number, mutation.title)).text,
              result: undefined,
            };
        }
      });
    });

  const syncSpaces: BrainstormService["Service"]["syncSpaces"] = (input) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      const next: PersistedBrainstorm = {
        ...current,
        spaces: input.spaces,
        customSpaceIdsByProjectId: input.customSpaceIdsByProjectId,
        defaultProfile: input.defaultProfile ?? null,
      };
      if (encodePersisted(next) === encodePersisted(current)) return;
      yield* Ref.set(stateRef, next);
      yield* save;
      yield* notify;
    });

  const setProjectInCustomSpace: BrainstormService["Service"]["setProjectInCustomSpace"] = (
    projectId,
    spaceId,
    member,
  ) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      const space = state.spaces.find((candidate) => candidate.id === spaceId);
      if (!space || space.kind !== "custom") {
        return yield* new BrainstormError({
          message: "Only custom spaces take projects; profile spaces and Other follow the path.",
        });
      }
      const current = state.customSpaceIdsByProjectId[projectId] ?? [];
      const updated = member
        ? current.includes(spaceId)
          ? current
          : [...current, spaceId]
        : current.filter((id) => id !== spaceId);
      if (
        updated.length === current.length &&
        updated.every((id, index) => id === current[index])
      ) {
        return;
      }
      const memberships = { ...state.customSpaceIdsByProjectId };
      if (updated.length > 0) memberships[projectId] = updated;
      else delete memberships[projectId];
      yield* Ref.set(stateRef, { ...state, customSpaceIdsByProjectId: memberships });
      yield* Ref.update(membershipRevision, (revision) => revision + 1);
      yield* save;
      yield* notify;
    });

  const spaceOfThread: BrainstormService["Service"]["spaceOfThread"] = (threadId) =>
    Ref.get(stateRef).pipe(
      Effect.map((state) => {
        const spaceId =
          Object.entries(state.threadIdsBySpaceId).find(
            ([, candidate]) => candidate === threadId,
          )?.[0] ??
          Object.entries(state.threadIdsBySpaceBrain ?? {})
            .find(([, candidate]) => candidate === threadId)?.[0]
            .split("|")[0];
        return state.spaces.find((space) => space.id === spaceId) ?? null;
      }),
    );

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const failWith = (message: string) => () => new BrainstormError({ message });

  const modelSelectionFor = (
    project: OrchestrationProjectShell,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(failWith("Could not read the server settings.")),
      );
      const recent = threads
        .filter((thread) => thread.projectId === project.id)
        .toSorted(
          (left, right) =>
            DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
        )[0];
      const projectDefault: ModelSelection = resolveProjectSettings(settings, project.id, project)
        .settings.defaultModelSelection ??
        settings.defaultModelSelection ??
        recent?.modelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
      if (settings.brainstormModelSelection) return settings.brainstormModelSelection;
      // The chat should answer in seconds, so it does not inherit a coding model.
      const providers = Option.isSome(providerRegistry)
        ? yield* providerRegistry.value.getProviders
        : [];
      return fastBrainstormModelSelection(providers, projectDefault) ?? projectDefault;
    });

  const realPath = (path: string) => Effect.promise(() => NodeFSP.realpath(path).catch(() => path));

  const open: BrainstormService["Service"]["open"] = (spaceId) =>
    openLock.withPermits(1)(
      Effect.gen(function* () {
        const ctx = yield* context;
        const space = yield* requireSpace(ctx, spaceId);
        const brainPath = brainPathOf(ctx, space);
        if (brainPath === null) {
          return yield* new BrainstormError({
            message: "No brain repository found (expected ~/code/<profile>/<profile>-brain).",
          });
        }
        const brainReal = yield* realPath(brainPath);

        let project: OrchestrationProjectShell | undefined;
        for (const candidate of ctx.projects) {
          if ((yield* realPath(candidate.workspaceRoot)) === brainReal) {
            project = candidate;
            break;
          }
        }
        if (!project) {
          const projectId = ProjectId.make(yield* uuid);
          yield* projectService
            .create({
              commandId: CommandId.make(`server:brainstorm-project:${yield* uuid}`),
              projectId,
              title: NodePath.basename(brainPath),
              workspaceRoot: brainPath,
            })
            .pipe(Effect.mapError(failWith(`Could not add ${brainPath} as a project.`)));
          const created = yield* projectService
            .getShell(projectId)
            .pipe(Effect.mapError(failWith("Could not read the new project.")));
          if (Option.isNone(created)) {
            return yield* new BrainstormError({ message: "The brain project did not appear." });
          }
          project = created.value;
        }

        const state = yield* Ref.get(stateRef);
        const brainKey = `${space.id}|${project.id}`;
        // This space's conversation in this brain, from before or current.
        let existing: OrchestrationV2ThreadShell | undefined;
        for (const id of [
          state.threadIdsBySpaceBrain?.[brainKey],
          state.threadIdsBySpaceId[space.id],
        ]) {
          if (!id) continue;
          const thread = yield* orchestrator
            .getThreadShell(ThreadId.make(id))
            .pipe(Effect.orElseSucceed(() => null));
          if (
            thread !== null &&
            thread.deletedAt === null &&
            thread.archivedAt === null &&
            thread.projectId === project.id
          ) {
            existing = thread;
            break;
          }
        }
        if (existing) {
          if (
            state.threadIdsBySpaceId[space.id] !== existing.id ||
            state.threadIdsBySpaceBrain?.[brainKey] !== existing.id
          ) {
            yield* Ref.update(stateRef, (current) => ({
              ...current,
              threadIdsBySpaceId: { ...current.threadIdsBySpaceId, [space.id]: existing.id },
              threadIdsBySpaceBrain: {
                ...current.threadIdsBySpaceBrain,
                [brainKey]: existing.id,
              },
            }));
            yield* save;
            yield* notify;
          }
          return { spaceId: space.id, projectId: project.id, threadId: existing.id, brainPath };
        }

        const threadId = ThreadId.make(yield* uuid);
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError(failWith("Could not read the server settings.")),
        );
        const snapshot = yield* orchestrator
          .getShellSnapshot({ location: "active" })
          .pipe(Effect.mapError(failWith("Could not read the threads.")));
        // An idle thread in the brain's own checkout; the popup sends the first message.
        yield* launches
          .launch({
            commandId: CommandId.make(`server:brainstorm-thread:${yield* uuid}`),
            threadId,
            projectId: project.id,
            title: `Brainstorm · ${space.name}`,
            modelSelection: yield* modelSelectionFor(project, snapshot.threads),
            runtimeMode: resolveProjectSettings(settings, project.id).settings.defaultRuntimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            workspaceStrategy: { type: "root" },
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(Effect.mapError(failWith("Could not create the brainstorm thread.")));
        // A brainstorm is long-lived; inactivity must not settle it away.
        yield* orchestrator
          .dispatch({
            type: "thread.auto-settle.set",
            commandId: CommandId.make(`server:brainstorm-autosettle:${yield* uuid}`),
            threadId,
            enabled: false,
          })
          .pipe(Effect.ignore);
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          threadIdsBySpaceId: { ...current.threadIdsBySpaceId, [space.id]: threadId },
          threadIdsBySpaceBrain: { ...current.threadIdsBySpaceBrain, [brainKey]: threadId },
        }));
        yield* save;
        yield* notify;
        return { spaceId: space.id, projectId: project.id, threadId, brainPath };
      }),
    );

  // Watch the directories that hold task files so hand edits reach clients.
  const watchers = new Map<string, NodeFS.FSWatcher>();
  const services = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(services);
  const onFileEvent = (_event: string, file: string | Buffer | null) => {
    if (file !== null && !String(file).endsWith(".md")) return;
    // The state stream debounces bursts of events from one save.
    runFork(notify);
  };
  const watchDirectories = (directories: ReadonlyArray<string>) =>
    Effect.sync(() => {
      const wanted = new Set(directories);
      for (const [directory, watcher] of watchers) {
        if (!wanted.has(directory)) {
          watcher.close();
          watchers.delete(directory);
        }
      }
      for (const directory of wanted) {
        if (watchers.has(directory) || !NodeFS.existsSync(directory)) continue;
        try {
          const watcher = NodeFS.watch(directory, onFileEvent);
          watcher.on("error", () => {
            watcher.close();
            watchers.delete(directory);
          });
          watchers.set(directory, watcher);
        } catch {
          // Unwatchable directories just miss live updates.
        }
      }
    });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    }),
  );

  const currentState = Effect.gen(function* () {
    const ctx = yield* context;
    const lists: BrainstormTaskList[] = [];
    const directories = new Set<string>();
    for (const space of ctx.spaces) {
      if (space.kind === "all") continue;
      const path = taskPathOf(ctx, space);
      if (path !== null) {
        directories.add(NodePath.dirname(path));
        // Watch the brain itself too, so a first `tasks/` folder is noticed.
        directories.add(NodePath.dirname(NodePath.dirname(path)));
      }
      lists.push(yield* readTaskList(ctx, space));
    }
    yield* watchDirectories([...directories]);
    const state = yield* Ref.get(stateRef);
    return {
      threadIdsBySpaceId: state.threadIdsBySpaceId as Record<string, ThreadId>,
      hiddenThreadIds: [...allBrainstormThreadIds(state)] as ThreadId[],
      taskLists: lists,
      customSpaceIdsByProjectId: state.customSpaceIdsByProjectId as Record<string, string[]>,
      membershipRevision: yield* Ref.get(membershipRevision),
      profiles: ctx.profiles.map((profile) => profile.name),
      defaultProfile: ctx.defaultProfile?.name ?? null,
    } satisfies BrainstormState;
  });

  const stateChanges: BrainstormService["Service"]["stateChanges"] = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      return Stream.concat(
        Stream.make(undefined),
        Stream.fromSubscription(subscription).pipe(Stream.debounce("100 millis")),
      ).pipe(
        Stream.mapEffect(() => currentState.pipe(Effect.option)),
        Stream.filter(Option.isSome),
        Stream.map((state) => state.value),
        Stream.changesWith((left, right) => encodeState(left) === encodeState(right)),
      );
    }),
  );

  return BrainstormService.of({
    syncSpaces,
    open,
    mutateTasks,
    stateChanges,
    context,
    spaceOfThread,
    readTaskList,
    editTasks,
    setProjectInCustomSpace,
  });
});

export const layer = Layer.effect(BrainstormService, make);
