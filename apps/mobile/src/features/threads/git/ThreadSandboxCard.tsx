import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { findSandboxForThread } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId, SandboxStatus, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { showConfirmDialog } from "../../../components/ConfirmDialogHost";
import { cn } from "../../../lib/cn";
import { useEnvironmentServerConfig } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { vcsEnvironment } from "../../../state/vcs";
import { SheetListRow } from "./gitSheetComponents";

const STATUS_LABEL: Record<SandboxStatus, string> = {
  starting: "Starting",
  running: "Running",
  sleeping: "Asleep",
  stopped: "Stopped",
  error: "Error",
};

function confirmDisable(onConfirm: () => void) {
  const title = "Take out of sandbox?";
  const message =
    "Later work in this thread runs on the host. The sandbox is deleted when its last thread leaves.";
  if (Platform.OS === "ios") {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Take out", style: "destructive", onPress: onConfirm },
    ]);
    return;
  }
  showConfirmDialog({ title, message, confirmText: "Take out", destructive: true, onConfirm });
}

/** The request error's own detail when the server sent one, else the error message. */
function failureMessage(cause: unknown): string | undefined {
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    const detail = (cause as { readonly detail: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return cause instanceof Error ? cause.message : undefined;
}

/**
 * Status, forwarded ports, and stop/take-out actions for a sandboxed thread;
 * a "Run in sandbox" action for a host thread on a server that offers
 * sandboxes. Only subscribes to the sandbox list when the server can run them.
 */
export function ThreadSandboxCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const serverConfig = useEnvironmentServerConfig(props.environmentId);
  const sandboxes = useEnvironmentQuery(
    serverConfig?.sandboxes === true
      ? vcsEnvironment.sandboxes({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const sandbox = findSandboxForThread(sandboxes.data?.sandboxes, props.threadId);
  const stopSandbox = useAtomCommand(vcsEnvironment.stopSandbox, { reportFailure: false });
  const enableSandbox = useAtomCommand(vcsEnvironment.enableSandbox, { reportFailure: false });
  const disableSandbox = useAtomCommand(vcsEnvironment.disableSandbox, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  const run = async (failureTitle: string, command: typeof stopSandbox) => {
    setBusy(true);
    try {
      const result = await command({
        environmentId: props.environmentId,
        input: { threadId: props.threadId },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      Alert.alert(failureTitle, failureMessage(squashAtomCommandFailure(result)));
    } finally {
      setBusy(false);
    }
  };

  if (!sandbox) {
    if (serverConfig?.sandboxes !== true) return null;
    return (
      <View className="overflow-hidden bg-card android:rounded-[20px] ios:rounded-[18px] ios:border ios:border-border">
        <View className="ios:px-3">
          <SheetListRow
            icon="cube"
            title="Run in sandbox"
            subtitle="Moves this thread into a sandbox of its folder"
            disabled={busy}
            onPress={() => void run("Could not enable sandbox", enableSandbox)}
          />
        </View>
      </View>
    );
  }
  const canStop =
    sandbox.status === "running" || sandbox.status === "starting" || sandbox.status === "sleeping";

  return (
    <View className="overflow-hidden bg-card android:rounded-[20px] ios:rounded-[18px] ios:border ios:border-border">
      <View className="gap-0.5 px-4 py-3">
        <Text className="text-foreground-muted text-2xs font-t3-bold tracking-[0.9px] uppercase">
          Sandbox
        </Text>
        <Text
          selectable
          className={cn(
            "text-sm font-medium",
            sandbox.status === "error" ? "text-danger-foreground" : "text-foreground",
          )}
          numberOfLines={1}
        >
          {STATUS_LABEL[sandbox.status]} · {sandbox.containerName}
        </Text>
        {sandbox.status === "error" && sandbox.error ? (
          <Text selectable className="text-xs text-danger-foreground">
            {sandbox.error}
          </Text>
        ) : null}
        {sandbox.ports.map((port) => (
          <Text
            key={`${port.containerPort}:${port.hostPort}`}
            selectable
            className="text-xs text-foreground-muted"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            :{port.containerPort} → 127.0.0.1:{port.hostPort}
          </Text>
        ))}
      </View>
      <View className="ios:px-3">
        {canStop ? (
          <>
            {Platform.OS !== "android" ? <View className="h-px bg-border" /> : null}
            <SheetListRow
              icon="stop.fill"
              title="Stop sandbox"
              subtitle="Starts again on the next command"
              disabled={busy}
              onPress={() => void run("Could not stop sandbox", stopSandbox)}
            />
          </>
        ) : null}
        {Platform.OS !== "android" ? (
          <View className={canStop ? "ml-12 h-px bg-border" : "h-px bg-border"} />
        ) : null}
        <SheetListRow
          icon="trash"
          title="Take out of sandbox"
          subtitle="Later work in this thread runs on the host"
          disabled={busy}
          onPress={() =>
            confirmDisable(() => void run("Could not take thread out of sandbox", disableSandbox))
          }
        />
      </View>
    </View>
  );
}
