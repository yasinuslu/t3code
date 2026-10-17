import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { useThreadPreviewState } from "../../previewStateStore";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { openPreviewSession } from "../preview/openPreviewSession";
import { PreviewPanel } from "../preview/PreviewPanel";
import { usePreviewSession } from "../preview/usePreviewSession";
import { findPreviewTabForUrl } from "../preview/threadPreviewLinkChip.logic";

/**
 * The prototype, shown on T3's own preview surface: the thread's browser tab
 * for this URL, with the same chrome the T3 view has. The tab is the thread's
 * own, so the agent's browser and this pane are one preview, not two. It is
 * opened here when the thread has none for the URL yet.
 */
export function GrowPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly url: string;
}) {
  const { environmentId, threadId, url } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const open = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  usePreviewSession(threadRef);
  const state = useThreadPreviewState(threadRef);
  const tabId = findPreviewTabForUrl(state.sessions, url);
  // The list is authoritative only once the server's epoch is known.
  const listed = state.serverEpoch !== null;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!listed || tabId !== null || requested.current === url) return;
    requested.current = url;
    void openPreviewSession({ openPreview: open, threadRef, url });
  }, [listed, open, tabId, threadRef, url]);
  if (tabId === null) return null;
  return <PreviewPanel mode="embedded" threadRef={threadRef} tabId={tabId} visible />;
}
