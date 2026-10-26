import type { ModelSelection } from "@t3tools/contracts";
import { toastManager } from "../ui/toast";

/**
 * Tells the user a message went to another account because the picked one is at its
 * usage limit, or warns that no account has room (see `sendSelectionAvoidingLimit`).
 */
export function announceLimitSwitch(
  sendCtx: { readonly limitSwitchedFrom: string | null; readonly limitStuckOn: string | null },
  sentWith: ModelSelection,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly displayName: string }>,
) {
  if (sendCtx.limitStuckOn !== null) {
    toastManager.add({
      type: "warning",
      title: `${sendCtx.limitStuckOn} is at its usage limit`,
      description: "No other account has room, so this message will likely fail.",
    });
    return;
  }
  const fromLabel = sendCtx.limitSwitchedFrom;
  if (fromLabel === null) return;
  const toLabel =
    providers.find((provider) => provider.instanceId === sentWith.instanceId)?.displayName ??
    sentWith.instanceId;
  toastManager.add({
    type: "info",
    title: `${fromLabel} is at its usage limit`,
    description: `Sent on ${toLabel} instead.`,
  });
}
