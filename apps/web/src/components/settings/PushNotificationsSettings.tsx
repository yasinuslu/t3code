import { pushCapabilityHint } from "../../pushNotifications.logic";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import { notificationsEnvironment } from "../../state/notifications";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Push to the owner on this device: the "Bildirimler" row. Needs the primary environment, since
 * a browser push subscription is bound to the one server key of the origin that serves the app.
 */
export function PushNotificationsSettings() {
  const push = usePushNotifications();
  const notify = useAtomCommand(notificationsEnvironment.notify);
  const { capability, environmentId } = push;

  // Without the primary environment (hosted app on remote environments only) there is no inbox.
  if (!environmentId || capability === null) return null;

  const subscribed = capability === "granted-subscribed";
  const canToggle =
    push.ready &&
    !push.busy &&
    (subscribed || capability === "default" || capability === "granted-not-subscribed");
  const description = [
    pushCapabilityHint(capability),
    subscribed ? `${push.deviceCount} cihaz kayıtlı.` : null,
  ]
    .filter((part) => part !== null)
    .join(" ");

  const sendTest = async () => {
    const result = await notify({
      environmentId,
      input: { title: "T3 Code", body: "Test bildirimi", priority: "normal" },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Test bildirimi gönderildi",
        description: `${result.value.pushed} cihaza iletildi.`,
      });
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("push-notifications")}
      description={description}
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant={subscribed ? "outline" : "default"}
            disabled={!canToggle}
            onClick={() => void (subscribed ? push.disable() : push.enable())}
          >
            {subscribed ? "Bildirimleri kapat" : "Bildirimleri aç"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void sendTest()}>
            Test bildirimi gönder
          </Button>
        </div>
      }
    />
  );
}
