import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { findSandboxForThread } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId, SandboxPort, SandboxStatus, ThreadId } from "@t3tools/contracts";
import { BoxIcon, LogOutIcon, SquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { useOpenLink } from "../../browser/useOpenLink";
import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

const SANDBOX_STATUS_LABELS: Record<SandboxStatus, string> = {
  starting: "Starting",
  running: "Running",
  sleeping: "Asleep",
  stopped: "Stopped",
  error: "Error",
};

const DISABLE_SANDBOX_CONFIRMATION = [
  "Take this thread out of its sandbox?",
  "Its later work runs on the host. The folder's files stay.",
  "When no other thread uses the sandbox, its machine, services, and installed packages are deleted.",
].join("\n");

const ENABLE_SANDBOX_CONFIRMATION = [
  "Run this thread in a sandbox?",
  "Its agent, terminals, and setup script move into an isolated machine of the thread's folder. Other threads in the folder stay on the host.",
].join("\n");

/**
 * Thread details row for a started thread on a server that can run
 * sandboxes: shows the thread's sandbox, or offers to move the thread into
 * one. It subscribes to the environment's sandboxes while mounted.
 */
export function ThreadSandboxControl({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const sandboxesQuery = useEnvironmentQuery(
    vcsEnvironment.sandboxes({ environmentId, input: {} }),
  );
  const sandbox = findSandboxForThread(sandboxesQuery.data?.sandboxes, threadId);
  const stopSandbox = useAtomCommand(vcsEnvironment.stopSandbox, { reportFailure: false });
  const enableSandbox = useAtomCommand(vcsEnvironment.enableSandbox, { reportFailure: false });
  const disableSandbox = useAtomCommand(vcsEnvironment.disableSandbox, { reportFailure: false });
  const openLink = useOpenLink(threadRef);
  const [pending, setPending] = useState(false);

  const runAction = async (action: "stop" | "enable" | "disable") => {
    if (action !== "stop") {
      const confirmed = await readLocalApi()?.dialogs.confirm(
        action === "enable" ? ENABLE_SANDBOX_CONFIRMATION : DISABLE_SANDBOX_CONFIRMATION,
        action === "disable" ? { variant: "destructive" } : undefined,
      );
      if (!confirmed) return;
    }
    setPending(true);
    const command =
      action === "stop" ? stopSandbox : action === "enable" ? enableSandbox : disableSandbox;
    const result = await command({ environmentId, input: { threadId } });
    setPending(false);
    if (result._tag === "Success") return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title:
          action === "stop"
            ? "Could not stop sandbox"
            : action === "enable"
              ? "Could not move the thread into a sandbox"
              : "Could not take the thread out of its sandbox",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };

  if (!sandbox) {
    return (
      <ThreadDetailsControl
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => void runAction("enable")}
      >
        <BoxIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate">Run in sandbox</span>
      </ThreadDetailsControl>
    );
  }

  const openPort = (port: SandboxPort) => {
    // The forwarded port listens on the server's loopback; remote clients need
    // the environment's own route to it.
    const url = resolveDiscoveredServerUrl(environmentId, `http://127.0.0.1:${port.hostPort}`);
    void openLink(url).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not open port",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  };

  return (
    <Menu>
      <MenuTrigger render={<ThreadDetailsControl size="sm" variant="ghost" aria-label="Sandbox" />}>
        <BoxIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate">Sandbox</span>
        {sandbox.status !== "running" ? (
          <span
            className={
              sandbox.status === "error"
                ? "shrink-0 text-3xs font-normal text-destructive-foreground"
                : "shrink-0 text-3xs font-normal text-muted-foreground/70"
            }
          >
            {SANDBOX_STATUS_LABELS[sandbox.status]}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" className="w-(--anchor-width)">
        <MenuGroup>
          <MenuGroupLabel>{SANDBOX_STATUS_LABELS[sandbox.status]}</MenuGroupLabel>
          {sandbox.status === "error" && sandbox.error ? (
            <p className="px-2 pb-1 text-xs text-destructive-foreground">{sandbox.error}</p>
          ) : null}
        </MenuGroup>
        {sandbox.ports.length > 0 ? (
          <MenuGroup>
            <MenuGroupLabel>Ports</MenuGroupLabel>
            {sandbox.ports.map((port) => (
              <MenuItem key={port.containerPort} onClick={() => openPort(port)}>
                <span className="font-mono text-xs">
                  :{port.containerPort} → 127.0.0.1:{port.hostPort}
                </span>
              </MenuItem>
            ))}
          </MenuGroup>
        ) : null}
        <MenuSeparator />
        <MenuItem
          disabled={pending || sandbox.status === "stopped"}
          onClick={() => void runAction("stop")}
        >
          <SquareIcon />
          Stop sandbox
        </MenuItem>
        <MenuItem
          variant="destructive"
          disabled={pending}
          onClick={() => void runAction("disable")}
        >
          <LogOutIcon />
          Take out of sandbox
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
