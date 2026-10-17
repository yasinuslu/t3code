import {
  DEFAULT_MODEL_BY_PROVIDER,
  isProviderAvailable,
  type CodeProfile,
  type CodeProfileBalancedAccount,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";

import { exhaustedLimitWindow, windowAppliesToModel } from "./usageLimits.ts";

const DEFAULT_ACCOUNT_WEIGHT = 50;

export type BalancedAccountSkipReason =
  | "missing"
  | "disabled"
  | "unavailable"
  | "signed-out"
  | "manual-only"
  | "no-model"
  | "limited";

export interface RankedAccount {
  readonly instance: ServerProvider;
  /** What the thread would run with on this account. */
  readonly selection: ModelSelection;
  /** Another account of the thread's own provider, so the model carries over. */
  readonly sameDriver: boolean;
}

export interface SkippedAccount {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  readonly reason: BalancedAccountSkipReason;
  /** Epoch milliseconds, when `reason` is `limited`. */
  readonly limitedUntil?: number;
}

/**
 * Share of quota left for `model`, 0..1: the tightest of the account's live
 * windows. A window whose reset has passed is spent history, and an account
 * that reports no windows is assumed to have room.
 */
export function accountRoom(
  limits: ServerProviderUsageLimits | undefined,
  model: string | undefined,
  now: number,
): number {
  let room = 1;
  for (const window of limits?.windows ?? []) {
    if (!windowAppliesToModel(window, model)) continue;
    const resetsAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
    if (Number.isFinite(resetsAt) && resetsAt <= now) continue;
    room = Math.min(room, 1 - Math.max(0, Math.min(100, window.usedPercent)) / 100);
  }
  return room;
}

// Spend up to this share of the weekly window; the rest is headroom.
const WEEK_TARGET = 90;
const FIVE_HOUR_CAP = 60;

/**
 * Use it or lose it: the share of the weekly window that must be spent per
 * hour until it resets to land on `WEEK_TARGET`, scaled down as the 5h window
 * fills. This mirrors `nep budget`'s balance. The weekly is the one that
 * applies to `model` (`seven_day_<model>` when the account has one, else
 * `seven_day`). Null when it is unread or already reset, so the caller falls
 * back to `accountRoom`.
 */
export function accountPace(
  limits: ServerProviderUsageLimits | undefined,
  model: string | undefined,
  now: number,
): number | null {
  let weekly: ServerProviderUsageWindow | undefined;
  let fiveHour: ServerProviderUsageWindow | undefined;
  for (const window of limits?.windows ?? []) {
    if (window.id === "five_hour") fiveHour = window;
    else if (window.id.startsWith("seven_day") && windowAppliesToModel(window, model)) {
      if (weekly === undefined || window.id !== "seven_day") weekly = window;
    }
  }
  const weeklyReset = weekly?.resetsAt === undefined ? Number.NaN : Date.parse(weekly.resetsAt);
  if (weekly === undefined || !Number.isFinite(weeklyReset) || weeklyReset <= now) return null;
  const hoursLeft = Math.max(1, (weeklyReset - now) / 3_600_000);
  const pace = Math.max(0, WEEK_TARGET - weekly.usedPercent) / hoursLeft;
  const fiveReset = fiveHour?.resetsAt === undefined ? Number.NaN : Date.parse(fiveHour.resetsAt);
  // A 5h window that already reset is spent history.
  const fiveUsed = fiveHour === undefined || fiveReset <= now ? 0 : fiveHour.usedPercent;
  return pace * Math.max(0.05, 1 - fiveUsed / FIVE_HOUR_CAP);
}

/**
 * When `model` can run on this account again, in epoch milliseconds, or null
 * when nothing says it is limited. `observedUntil` is the reset time of a
 * limit a turn on this account actually hit.
 */
export function accountLimitedUntil(
  provider: Pick<ServerProvider, "usageLimits">,
  model: string | undefined,
  observedUntil: number | undefined,
  now: number,
): number | null {
  const window = exhaustedLimitWindow(provider.usageLimits, model, now);
  const windowUntil = window?.resetsAt === undefined ? 0 : Date.parse(window.resetsAt);
  const until = Math.max(observedUntil ?? 0, Number.isFinite(windowUntil) ? windowUntil : 0);
  return until > now ? until : null;
}

/**
 * Key of a limit a turn hit. Limits are per model: an account out of one
 * model's quota still runs the others.
 */
export function observedLimitKey(instanceId: ProviderInstanceId, model: string): string {
  return `${instanceId} ${model}`;
}

function defaultModel(provider: ServerProvider): string | undefined {
  return (
    provider.models.find((model) => model.isDefault)?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider.driver] ??
    provider.models[0]?.slug
  );
}

/**
 * The accounts a thread running `selection` could use, best first: accounts of
 * its own provider by quota left (times their weight), then accounts of other
 * providers in list order. Same-provider accounts score by weekly pace (see
 * `accountPace`) and by quota left where a weekly is unread. The selection's own instance competes like any
 * other unless `exclude` names it. Callers supply the limits turns actually
 * hit, by `observedLimitKey`; exhausted quota windows are read from the
 * provider snapshots.
 */
export function rankBalancedAccounts(input: {
  readonly accounts: ReadonlyArray<CodeProfileBalancedAccount>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selection: ModelSelection;
  readonly observedLimits: ReadonlyMap<string, number>;
  readonly exclude?: ReadonlySet<ProviderInstanceId>;
  readonly now: number;
}): {
  readonly ranked: ReadonlyArray<RankedAccount>;
  readonly skipped: ReadonlyArray<SkippedAccount>;
} {
  const { providers, selection, now } = input;
  const driver = providers.find((provider) => provider.instanceId === selection.instanceId)?.driver;
  const sameDriver: Array<
    RankedAccount & { readonly weight: number; readonly room: number; readonly pace: number | null }
  > = [];
  const otherDrivers: Array<RankedAccount> = [];
  const skipped: Array<SkippedAccount> = [];
  const seen = new Set<ProviderInstanceId>();
  for (const account of input.accounts) {
    if (seen.has(account.instanceId) || input.exclude?.has(account.instanceId)) continue;
    seen.add(account.instanceId);
    const instance = providers.find((provider) => provider.instanceId === account.instanceId);
    const skip = (reason: BalancedAccountSkipReason, limitedUntil?: number) =>
      skipped.push({
        instanceId: account.instanceId,
        label: instance?.displayName ?? account.instanceId,
        reason,
        ...(limitedUntil === undefined ? {} : { limitedUntil }),
      });
    if (instance === undefined) {
      skip("missing");
      continue;
    }
    const weight = account.weight ?? DEFAULT_ACCOUNT_WEIGHT;
    if (weight <= 0) {
      skip("manual-only");
      continue;
    }
    if (!instance.enabled) {
      skip("disabled");
      continue;
    }
    if (!isProviderAvailable(instance) || !instance.installed) {
      skip("unavailable");
      continue;
    }
    if (instance.auth.status === "unauthenticated") {
      skip("signed-out");
      continue;
    }
    const same = instance.driver === driver;
    const model = same ? selection.model : (account.model ?? defaultModel(instance));
    if (model === undefined) {
      skip("no-model");
      continue;
    }
    const limitedUntil = accountLimitedUntil(
      instance,
      model,
      input.observedLimits.get(observedLimitKey(instance.instanceId, model)),
      now,
    );
    if (limitedUntil !== null) {
      skip("limited", limitedUntil);
      continue;
    }
    if (same) {
      sameDriver.push({
        instance,
        selection: { ...selection, instanceId: instance.instanceId },
        sameDriver: true,
        weight,
        room: accountRoom(instance.usageLimits, model, now),
        pace: accountPace(instance.usageLimits, model, now),
      });
    } else {
      otherDrivers.push({
        instance,
        selection: { instanceId: instance.instanceId, model },
        sameDriver: false,
      });
    }
  }
  // Pace and room are different scales, so one account without a readable
  // weekly puts the whole ranking on room.
  const byPace = sameDriver.every((account) => account.pace !== null);
  const score = (account: (typeof sameDriver)[number]) =>
    account.weight * (byPace ? (account.pace ?? 0) : account.room);
  return {
    ranked: [
      // A stable sort keeps list order between accounts with equal scores.
      ...[...sameDriver]
        .sort((left, right) => score(right) - score(left))
        .map(({ weight: _weight, room: _room, pace: _pace, ...account }) => account),
      ...otherDrivers,
    ],
    skipped,
  };
}

/**
 * The accounts a new thread on `instanceId` is balanced across: the accounts of
 * its provider that one profile with balancing on lists beside it. Null when
 * no profile balances it with another account, so there is nothing to choose.
 */
export function balancedAccountGroup(
  codeProfiles: Readonly<Record<string, CodeProfile>>,
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ReadonlyArray<ServerProvider> | null {
  const driver = providers.find((provider) => provider.instanceId === instanceId)?.driver;
  if (driver === undefined) return null;
  for (const profile of Object.values(codeProfiles)) {
    const balancing = profile.accountBalancing;
    if (balancing?.enabled !== true) continue;
    const group = balancing.accounts
      .filter((account) => (account.weight ?? DEFAULT_ACCOUNT_WEIGHT) > 0)
      .flatMap((account) =>
        providers.filter(
          (provider) => provider.instanceId === account.instanceId && provider.driver === driver,
        ),
      );
    if (group.length > 1 && group.some((provider) => provider.instanceId === instanceId)) {
      return group;
    }
  }
  return null;
}
