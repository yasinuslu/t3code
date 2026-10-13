import type { CodeProfile, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { balancedAccountGroup } from "@t3tools/shared/accountBalancing";

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
