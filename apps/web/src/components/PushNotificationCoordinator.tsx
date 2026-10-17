import { useEffect, useRef } from "react";
import * as Schema from "effect/Schema";
import { BellIcon } from "lucide-react";

import { usePushNotifications } from "../hooks/usePushNotifications";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { currentSubscriptionForServer } from "../pushNotifications";
import { NEEDS_INSTALL_HINT, pushPromptKind } from "../pushNotifications.logic";
import { notificationsEnvironment, usePrimaryNotifications } from "../state/notifications";
import { useAtomCommand } from "../state/use-atom-command";
import { toastManager } from "./ui/toast";

const PROMPT_DISMISSED_STORAGE_KEY = "t3code:push-notifications-prompt-dismissed:v1";

// Guards against a second toast from a remount or a Strict Mode effect replay.
let promptShown = false;

function isPromptDismissed(): boolean {
  try {
    return getLocalStorageItem(PROMPT_DISMISSED_STORAGE_KEY, Schema.Boolean) === true;
  } catch {
    return false;
  }
}

function dismissPrompt() {
  try {
    setLocalStorageItem(PROMPT_DISMISSED_STORAGE_KEY, true, Schema.Boolean);
  } catch {
    // Storage is unavailable. The prompt shows again on the next launch.
  }
}

/**
 * Keeps this device's push subscription known to the server and offers push once. Renders
 * nothing. On start with permission granted it re-sends the existing subscription (the server
 * keys devices by endpoint, so this is idempotent and heals a server that lost its list, or
 * one whose VAPID key changed). The one-time prompt is a toast that any close dismisses for good.
 */
export function PushNotificationCoordinator() {
  const { environmentId, state } = usePrimaryNotifications();
  const push = usePushNotifications();
  const subscribeOnServer = useAtomCommand(notificationsEnvironment.pushSubscribe, {
    reportFailure: false,
  });
  const publicKey = state?.push.publicKey ?? null;

  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!environmentId || !publicKey) return;
    const syncKey = `${environmentId}:${publicKey}`;
    if (syncedRef.current === syncKey) return;
    syncedRef.current = syncKey;
    void currentSubscriptionForServer(publicKey).then((input) => {
      if (input) void subscribeOnServer({ environmentId, input });
    });
  }, [environmentId, publicKey, subscribeOnServer]);

  const enableRef = useRef(push.enable);
  useEffect(() => {
    enableRef.current = push.enable;
  });
  const kind = push.capability === null ? null : pushPromptKind(push.capability);
  useEffect(() => {
    if (kind === null || !push.ready || promptShown || isPromptDismissed()) return;
    promptShown = true;
    const toastId = toastManager.add({
      title: kind === "enable" ? "Bildirimleri aç" : "Bildirimler için uygulamayı yükle",
      description:
        kind === "enable"
          ? "Biten işler ve senden bekleyenler telefonuna ve bilgisayarına anında düşsün."
          : NEEDS_INSTALL_HINT,
      timeout: 0,
      onClose: dismissPrompt,
      ...(kind === "enable"
        ? {
            actionProps: {
              children: "Bildirimleri aç",
              // A click on the toast action is the user gesture the permission prompt needs.
              onClick: () => {
                void enableRef.current();
                toastManager.close(toastId);
              },
            },
          }
        : {}),
      data: {
        leadingIcon: <BellIcon className="size-4" />,
        ...(kind === "enable"
          ? {
              actionLayout: "stacked-end" as const,
              secondaryActionProps: {
                children: "Şimdi değil",
                onClick: () => toastManager.close(toastId),
              },
              secondaryActionVariant: "ghost" as const,
            }
          : {}),
      },
    });
  }, [kind, push.ready]);

  return null;
}
