import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import type { UsageChartMetric } from "./UsageProviderChart";
import { resolveShortcutCommand, type ShortcutEventLike } from "../../keybindings";
import { useHomeOverlayStore } from "../../homeOverlayStore";

export type UsageMetric = UsageChartMetric | "limits";
export const METRIC_OPTIONS = [
  { value: "cost", label: "Cost", command: "usage.cost" },
  { value: "tokens", label: "Tokens", command: "usage.tokens" },
  { value: "limits", label: "Limits", command: "usage.limits" },
] as const satisfies readonly { value: UsageMetric; label: string; command: KeybindingCommand }[];

export const WINDOW_OPTIONS = [
  { days: 1, label: "Past 24h", command: "usage.period.day" },
  { days: 7, label: "7 days", command: "usage.period.week" },
  { days: 30, label: "30 days", command: "usage.period.month" },
  { days: 90, label: "90 days", command: "usage.period.quarter" },
] as const;

export function resolveUsageShortcut(
  event: ShortcutEventLike & { target: EventTarget | null },
  keybindings: ResolvedKeybindingsConfig,
) {
  // Grow covers the page and holds the same Alt letters (Alt+C snoozes there).
  if (useHomeOverlayStore.getState().open) return null;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable ||
      target.closest(
        '[role="dialog"]:not([data-app-modal]), [aria-modal="true"]:not([data-app-modal]), [data-slot$="popup"]:not([data-app-modal])',
      ))
  ) {
    return null;
  }

  return resolveShortcutCommand(event, keybindings, {
    context: { usagePageOpen: true },
  });
}
