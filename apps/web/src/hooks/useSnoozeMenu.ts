import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { requestCustomSnooze } from "../components/CustomSnoozeDialog";
import { resolveSnoozePresets } from "../components/Sidebar.snooze";
import type { ThreadActionMenuId } from "../components/threadActionMenu.logic";
import { readLocalApi } from "../localApi";
import { useClientSettings } from "./useSettings";

/**
 * The snooze choices on their own (the presets and Custom…) as a menu at `position`, for a
 * place that has no row to hang the hover clock on: a key press, a header button. Resolves to
 * the wake time picked, or null when the menu was dismissed.
 */
export function useSnoozeMenu() {
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  return useCallback(
    async (position: { x: number; y: number }): Promise<string | null> => {
      const api = readLocalApi();
      if (!api) return null;
      // Presets resolve at open time, so "In 1 hour" is relative to the key press.
      const presets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show<ThreadActionMenuId>(
          [
            ...presets.map((preset) => ({
              id: `snooze:${preset.id}` as const,
              label: `${preset.label} (${preset.whenLabel})`,
            })),
            { id: "snooze:custom" as const, label: "Custom…", separatorBefore: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return null;
      const preset =
        clicked.value === "snooze:custom"
          ? await requestCustomSnooze()
          : presets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
      return preset?.snoozedUntil ?? null;
    },
    [timestampFormat],
  );
}
