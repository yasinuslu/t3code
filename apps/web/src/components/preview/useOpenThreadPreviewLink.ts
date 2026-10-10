import type { ScopedThreadRef, ThreadPreviewLinkState } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { openUrlInPreview } from "~/browser/openFileInPreview";
import { recordVisitForThread } from "~/browserHistoryStore";
import { readLocalApi } from "~/localApi";
import {
  isPreviewSupportedInRuntime,
  readThreadPreviewState,
  setActivePreviewTab,
} from "~/previewStateStore";
import { selectThreadPreviewMiniPlayer, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { refreshPreviewLinkStates } from "~/state/previewLinks";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import { findPreviewTabForUrl } from "./threadPreviewLinkChip.logic";

/** Opens the URL in the system browser, or a new tab on web. Called synchronously from a click so web popups are not blocked. */
export function openPreviewLinkExternally(url: string): void {
  const api = readLocalApi();
  if (!api) return;
  void api.shell.openExternal(url).catch(() => {
    toastManager.add({ type: "error", title: "Could not open the link" });
  });
}

/**
 * Opens a thread's preview link in the browser panel docked on the right, attached to that
 * thread. A tab already showing the preview is focused rather than duplicated. Web without the
 * desktop browser opens a new tab instead. A removed preview is not opened at all.
 */
export function useOpenThreadPreviewLink(): (
  threadRef: ScopedThreadRef,
  url: string,
  state: ThreadPreviewLinkState,
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return useCallback(
    async (threadRef, url, state) => {
      if (state === "gone") {
        toastManager.add({ type: "info", title: "This preview was removed" });
        return;
      }
      if (!isPreviewSupportedInRuntime()) {
        openPreviewLinkExternally(url);
        refreshPreviewLinkStates(threadRef.environmentId, [url]);
        return;
      }
      const existingTabId = findPreviewTabForUrl(readThreadPreviewState(threadRef).sessions, url);
      if (existingTabId !== null) {
        // The tab may be floating in the mini-player; docking it takes it out of there.
        const miniPlayer = selectThreadPreviewMiniPlayer(
          usePreviewMiniPlayerStore.getState().byThreadKey,
          threadRef,
        );
        if (miniPlayer?.source.kind === "browser" && miniPlayer.source.tabId === existingTabId) {
          usePreviewMiniPlayerStore.getState().close(threadRef);
        }
        setActivePreviewTab(threadRef, existingTabId);
        useRightPanelStore.getState().openBrowser(threadRef, existingTabId);
      } else {
        const result = await openUrlInPreview({ threadRef, url, openPreview });
        if (isAtomCommandInterrupted(result)) return;
        if (result._tag === "Failure") {
          console.error(result.cause);
          toastManager.add({ type: "error", title: "Could not open the preview" });
          return;
        }
        recordVisitForThread(threadRef, url);
      }
      // Opening wakes a stopped preview; refresh so the dot follows without waiting a cycle.
      refreshPreviewLinkStates(threadRef.environmentId, [url]);
    },
    [openPreview],
  );
}
