import { useCallback, useEffect, useState } from "react";

import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  readPushDeviceState,
} from "../pushNotifications";
import type { PushCapability } from "../pushNotifications.logic";
import { notificationsEnvironment, usePrimaryNotifications } from "../state/notifications";
import { useAtomCommand } from "../state/use-atom-command";
import { toastManager } from "../components/ui/toast";

/**
 * This device's push state and the enable/disable actions. `enable` has to be called straight
 * from a click handler (the browser's permission prompt needs the user gesture).
 */
export function usePushNotifications() {
  const { environmentId, state } = usePrimaryNotifications();
  const subscribeOnServer = useAtomCommand(notificationsEnvironment.pushSubscribe);
  const unsubscribeOnServer = useAtomCommand(notificationsEnvironment.pushUnsubscribe);
  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const read = () => {
      void readPushDeviceState().then((device) => {
        if (active) setCapability(device.capability);
      });
    };
    read();
    // Permission is changed in browser settings, outside the app; re-read on return.
    window.addEventListener("focus", read);
    return () => {
      active = false;
      window.removeEventListener("focus", read);
    };
  }, []);

  const publicKey = state?.push.publicKey ?? null;

  // Runs `action`, then re-reads what the browser says, so the controls follow the outcome.
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setCapability((await readPushDeviceState()).capability);
      setBusy(false);
    }
  }, []);

  const enable = () =>
    run(async () => {
      if (!environmentId || !publicKey) return;
      const result = await enablePushOnThisDevice(publicKey);
      if (result.kind === "subscribed") {
        await subscribeOnServer({ environmentId, input: result.input });
      } else if (result.kind === "failed") {
        toastManager.add({
          type: "error",
          title: "Bildirimler açılamadı",
          description: result.message,
        });
      }
    });

  const disable = () =>
    run(async () => {
      if (!environmentId) return;
      const endpoint = await disablePushOnThisDevice();
      if (endpoint) await unsubscribeOnServer({ environmentId, input: { endpoint } });
    });

  return {
    environmentId,
    capability,
    deviceCount: state?.push.deviceCount ?? 0,
    ready: environmentId !== null && publicKey !== null,
    busy,
    enable,
    disable,
  };
}
