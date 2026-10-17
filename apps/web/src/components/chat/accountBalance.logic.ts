import type {
  CodeProfile,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { balancedAccountGroup, rankBalancedAccounts } from "@t3tools/shared/accountBalancing";
import { exhaustedLimitWindow } from "@t3tools/shared/usageLimits";

/** Which account of a provider runs a draft thread's first turn. Unset means auto. */
export type AccountSelection = "auto" | "manual";

/**
 * What the model picker needs to offer "Auto balance": the accounts a code
 * profile balances this provider across, whether the draft is on auto, and
 * what choosing the Auto entry does.
 */
export interface AccountBalancePicker {
  readonly instanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly auto: boolean;
  readonly onAuto: () => void;
}

/**
 * The accounts a new thread on `instanceId` can be balanced across, or null
 * when there is nothing to choose between or the thread already exists.
 */
export function newThreadAccountGroup(input: {
  readonly isNewThread: boolean;
  readonly codeProfiles: Readonly<Record<string, CodeProfile>> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly instanceId: ProviderInstanceId;
}): ReadonlyArray<ServerProvider> | null {
  if (!input.isNewThread || input.codeProfiles === undefined) return null;
  return balancedAccountGroup(input.codeProfiles, input.providers, input.instanceId);
}

/**
 * The `accountBalance` a thread launch carries: "auto" only for a new thread
 * whose draft is not pinned to an account and whose provider has accounts to
 * balance. Left out otherwise, so the named account is used as picked.
 */
export function accountBalanceForLaunch(input: {
  readonly isNewThread: boolean;
  readonly accountSelection: AccountSelection | undefined;
  readonly codeProfiles: Readonly<Record<string, CodeProfile>> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly instanceId: ProviderInstanceId;
}): "auto" | undefined {
  return input.accountSelection !== "manual" && newThreadAccountGroup(input) !== null
    ? "auto"
    : undefined;
}

/**
 * The selection a message is sent with: `selection` unless its account is
 * known to be out of quota for the model and another account of the same
 * provider has room, which then runs the turn instead. The thread's own
 * account is preferred, so a stale pick falls back to where the thread is.
 * `from` is the limited account, set only when the selection changed;
 * `stuckOn` is the limited account when no other account has room, so the
 * message still goes out on it and the caller can warn instead of letting it
 * fail silently.
 */
export function sendSelectionAvoidingLimit(input: {
  readonly selection: ModelSelection;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** The account the thread currently runs on, when it has started. */
  readonly threadInstanceId?: ProviderInstanceId | undefined;
  readonly now?: number;
}): {
  readonly selection: ModelSelection;
  readonly from: ServerProvider | null;
  readonly stuckOn: ServerProvider | null;
} {
  const now = input.now ?? Date.now();
  const unchanged = { selection: input.selection, from: null, stuckOn: null };
  const current = input.providers.find(
    (provider) => provider.instanceId === input.selection.instanceId,
  );
  if (!current || !exhaustedLimitWindow(current.usageLimits, input.selection.model, now)) {
    return unchanged;
  }
  const { ranked } = rankBalancedAccounts({
    accounts: input.providers
      .filter((provider) => provider.driver === current.driver)
      .map((provider) => ({ instanceId: provider.instanceId })),
    providers: input.providers,
    selection: input.selection,
    observedLimits: new Map(),
    exclude: new Set([current.instanceId]),
    now,
  });
  const sameProvider = ranked.filter((account) => account.sameDriver);
  const next =
    sameProvider.find((account) => account.instance.instanceId === input.threadInstanceId) ??
    sameProvider[0];
  return next
    ? { selection: next.selection, from: current, stuckOn: null }
    : { ...unchanged, stuckOn: current };
}
