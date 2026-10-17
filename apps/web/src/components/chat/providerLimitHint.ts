import type { ServerProvider } from "@t3tools/contracts";
import { exhaustedLimitWindow, formatResetsIn } from "@t3tools/shared/usageLimits";

/**
 * "Limit reached · resets in 3h 5m" when the provider's account is out of
 * quota for `model` (any account-wide window when `model` is undefined), else
 * null. Computed at render: nothing here ticks.
 */
export function providerLimitHint(
  provider: Pick<ServerProvider, "usageLimits">,
  model: string | undefined,
  now: number = Date.now(),
): string | null {
  const window = exhaustedLimitWindow(provider.usageLimits, model, now);
  return window ? `Limit reached · ${formatResetsIn(window, now)}` : null;
}
