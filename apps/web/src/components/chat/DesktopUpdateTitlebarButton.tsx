import type { DesktopUpdateState } from "@t3tools/contracts";
import { DownloadIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type TitlebarUpdatePhase = "available" | "downloading" | "ready";

export function resolveTitlebarUpdatePhase(
  state: DesktopUpdateState | null,
): TitlebarUpdatePhase | null {
  if (!state) return null;
  if (state.status === "downloading") return "downloading";
  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "install") return "ready";
  if (action === "download") return "available";
  return null;
}

/**
 * The app update in the titlebar: shown only while an update is on its way. Updates download
 * by themselves; nothing changes until the user clicks Restart.
 */
export function DesktopUpdateTitlebarButton() {
  return isElectron ? <DesktopUpdateTitlebarControl /> : null;
}

function DesktopUpdateTitlebarControl() {
  const state = useDesktopUpdateState();
  const [pending, setPending] = useState(false);
  const phase = resolveTitlebarUpdatePhase(state);
  if (!state || !phase) return null;

  const percent =
    typeof state.downloadPercent === "number" ? Math.floor(state.downloadPercent) : null;
  const label =
    phase === "ready"
      ? "Restart to update"
      : phase === "downloading"
        ? `Downloading${percent !== null && percent > 0 ? ` ${percent}%` : "…"}`
        : "Update available";

  const run = (
    title: string,
    action: () => Promise<Parameters<typeof getDesktopUpdateActionError>[0]>,
  ) => {
    setPending(true);
    action()
      .then((result) => {
        const error = getDesktopUpdateActionError(result);
        if (error)
          toastManager.add(stackedThreadToast({ type: "error", title, description: error }));
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title,
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  const onClick = () => {
    const bridge = window.desktopBridge;
    if (!bridge || pending) return;
    if (phase === "ready") run("Could not install update", () => bridge.installUpdate());
    else if (phase === "available") run("Could not download update", () => bridge.downloadUpdate());
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="[-webkit-app-region:no-drag]"
            variant={phase === "ready" ? "default" : "outline"}
            size="xs"
            aria-disabled={phase === "downloading" || pending || undefined}
            onClick={onClick}
            data-desktop-update-phase={phase}
          >
            {phase === "ready" ? <RotateCwIcon /> : <DownloadIcon />}
            {label}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{getDesktopUpdateButtonTooltip(state)}</TooltipPopup>
    </Tooltip>
  );
}
