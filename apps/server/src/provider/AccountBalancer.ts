/**
 * AccountBalancer - which provider account a thread runs on, for code profiles
 * that turn account balancing on (`settings.codeProfiles.<name>.accountBalancing`).
 *
 * It owns the limit state the choice needs: the reset time of every usage
 * limit a turn actually hit, per provider instance and model, kept across
 * restarts. The quota windows providers report are read from their snapshots.
 *
 * @module provider/AccountBalancer
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  type CodeProfileAccountBalancing,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  accountLimitedUntil,
  observedLimitKey,
  rankBalancedAccounts,
  type RankedAccount,
  type SkippedAccount,
} from "@t3tools/shared/accountBalancing";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodeProfiles } from "./CodeProfiles.ts";
import * as ProviderRegistry from "./Services/ProviderRegistry.ts";

/** A limit a turn hit: when it was seen and when it resets, in epoch milliseconds. */
const ObservedLimit = Schema.Struct({ since: Schema.Number, until: Schema.Number });
type ObservedLimit = typeof ObservedLimit.Type;

/** Keyed by `observedLimitKey`. */
const PersistedLimits = Schema.fromJsonString(Schema.Record(Schema.String, ObservedLimit));
const decodePersistedLimits = Schema.decodeUnknownOption(PersistedLimits);
const encodePersistedLimits = Schema.encodeSync(PersistedLimits);

export interface AccountRanking {
  readonly profile: string;
  readonly balancing: CodeProfileAccountBalancing;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly ranked: ReadonlyArray<RankedAccount>;
  readonly skipped: ReadonlyArray<SkippedAccount>;
  readonly now: number;
}

export interface LaunchAccountChoice {
  readonly modelSelection: ModelSelection;
  /** Set when a limited account the launch named was replaced. */
  readonly replaced?: {
    readonly from: string;
    readonly to: string;
    /** Milliseconds until the named account can run the model again. */
    readonly limitedFor: number;
  };
}

export class AccountBalancer extends Context.Service<
  AccountBalancer,
  {
    /** Remembers that a turn of `model` on `instanceId` hit a limit lasting until `resetAt`. */
    readonly recordLimit: (
      instanceId: ProviderInstanceId,
      model: string,
      resetAt: string | null | undefined,
    ) => Effect.Effect<void>;
    /**
     * A turn of `model` on `instanceId` that started at `startedAt` (epoch
     * milliseconds) finished, so a limit seen before it started is over.
     */
    readonly clearLimit: (
      instanceId: ProviderInstanceId,
      model: string,
      startedAt: number,
    ) => Effect.Effect<void>;
    /**
     * The accounts a thread of this project running `selection` could use,
     * best first, without the instances in `exclude`. Null when the code
     * profile the project root belongs to does not balance accounts.
     */
    readonly rank: (input: {
      readonly projectId: ProjectId;
      readonly selection: ModelSelection;
      readonly exclude?: ReadonlySet<ProviderInstanceId>;
    }) => Effect.Effect<AccountRanking | null>;
    /**
     * The account a new thread of this project starts on. `auto` takes the
     * listed account with the most quota left; `pinned` keeps the named
     * instance unless it is limited right now.
     */
    readonly chooseForLaunch: (input: {
      readonly projectId: ProjectId;
      readonly selection: ModelSelection;
      readonly mode: "auto" | "pinned";
    }) => Effect.Effect<LaunchAccountChoice>;
  }
>()("t3/provider/AccountBalancer") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const codeProfiles = yield* CodeProfiles;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const statePath = NodePath.join(config.stateDir, "account-limits.json");

  const persisted = yield* Effect.promise(() =>
    NodeFSP.readFile(statePath, "utf8").catch(() => ""),
  );
  const startedAt = yield* Clock.currentTimeMillis;
  const limits = yield* Ref.make<ReadonlyMap<string, ObservedLimit>>(
    new Map(
      Object.entries(Option.getOrElse(decodePersistedLimits(persisted), () => ({}))).filter(
        ([, limit]) => limit.until > startedAt,
      ),
    ),
  );
  const observedUntil = Ref.get(limits).pipe(
    Effect.map((current) => new Map(Array.from(current, ([key, limit]) => [key, limit.until]))),
  );

  // One writer at a time: two saves would race over the same temp file.
  const saving = yield* Semaphore.make(1);
  const save = Ref.get(limits).pipe(
    Effect.flatMap((current) =>
      Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(statePath), { recursive: true });
        const temp = `${statePath}.${process.pid}.tmp`;
        await NodeFSP.writeFile(temp, `${encodePersistedLimits(Object.fromEntries(current))}\n`);
        await NodeFSP.rename(temp, statePath);
      }),
    ),
    Effect.catchCause((cause) => Effect.logWarning("could not save account limits", { cause })),
    saving.withPermits(1),
  );

  const recordLimit: AccountBalancer["Service"]["recordLimit"] = Effect.fn(
    "AccountBalancer.recordLimit",
  )(function* (instanceId, model, resetAt) {
    const until = resetAt == null ? Number.NaN : Date.parse(resetAt);
    const now = yield* Clock.currentTimeMillis;
    // Nothing says when a limit without a reset time ends, so it blocks nothing.
    if (!Number.isFinite(until) || until <= now) return;
    const key = observedLimitKey(instanceId, model);
    const changed = yield* Ref.modify(limits, (current) =>
      current.get(key)?.until === until
        ? [false, current]
        : [true, new Map(current).set(key, { since: now, until })],
    );
    if (changed) yield* save;
  });

  const clearLimit: AccountBalancer["Service"]["clearLimit"] = Effect.fn(
    "AccountBalancer.clearLimit",
  )(function* (instanceId, model, startedAt) {
    const key = observedLimitKey(instanceId, model);
    const changed = yield* Ref.modify(limits, (current) => {
      const limit = current.get(key);
      if (limit === undefined || startedAt <= limit.since) return [false, current];
      const next = new Map(current);
      next.delete(key);
      return [true, next];
    });
    if (changed) yield* save;
  });

  const rank: AccountBalancer["Service"]["rank"] = Effect.fn("AccountBalancer.rank")(
    function* (input) {
      const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
      if (
        settings === null ||
        !Object.values(settings.codeProfiles).some((profile) => profile.accountBalancing?.enabled)
      )
        return null;
      // A thread's worktree can live anywhere; its project root says whose work it is.
      const project = yield* projects
        .getById(input.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project)) return null;
      const resolved = yield* codeProfiles.resolve(project.value.workspaceRoot);
      if (resolved === undefined) return null;
      const balancing = settings.codeProfiles[resolved.name]?.accountBalancing;
      if (balancing?.enabled !== true) return null;
      const providers = yield* providerRegistry.getProviders;
      const now = yield* Clock.currentTimeMillis;
      return {
        profile: resolved.name,
        balancing,
        providers,
        now,
        ...rankBalancedAccounts({
          accounts: balancing.accounts,
          providers,
          selection: input.selection,
          observedLimits: yield* observedUntil,
          ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
          now,
        }),
      };
    },
  );

  const chooseForLaunch: AccountBalancer["Service"]["chooseForLaunch"] = Effect.fn(
    "AccountBalancer.chooseForLaunch",
  )(function* ({ projectId, selection, mode }) {
    const ranking = yield* rank({ projectId, selection });
    const best = ranking?.ranked[0];
    if (ranking === null || best === undefined) return { modelSelection: selection };
    const named = ranking.providers.find(
      (provider) => provider.instanceId === selection.instanceId,
    );
    const listed = ranking.balancing.accounts.some(
      (account) => account.instanceId === selection.instanceId,
    );
    const limitedUntil =
      named === undefined
        ? null
        : accountLimitedUntil(
            named,
            selection.model,
            (yield* observedUntil).get(observedLimitKey(named.instanceId, selection.model)),
            ranking.now,
          );
    // An account the profile does not list is not this profile's to replace.
    if (listed && limitedUntil !== null && best.instance.instanceId !== selection.instanceId) {
      return {
        modelSelection: best.selection,
        replaced: {
          from: named?.displayName ?? selection.instanceId,
          to: best.instance.displayName ?? best.instance.instanceId,
          limitedFor: limitedUntil - ranking.now,
        },
      };
    }
    // Balancing spreads threads across accounts of one provider; it never
    // sends a thread that asked for one provider to another with room.
    return mode === "auto" && listed && best.sameDriver
      ? { modelSelection: best.selection }
      : { modelSelection: selection };
  });

  return AccountBalancer.of({ recordLimit, clearLimit, rank, chooseForLaunch });
});

export const layer = Layer.effect(AccountBalancer, make);
