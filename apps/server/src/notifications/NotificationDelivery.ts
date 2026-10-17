import type { UserNotification } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** A device that receives pushes: a browser `PushSubscription`. */
export interface PushDevice {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly label?: string | undefined;
  readonly createdAt: string;
}

export interface DeliveryReport {
  /** Devices the push service accepted the message for. */
  readonly accepted: number;
  /** Endpoints the push service says are gone for good; the caller forgets them. */
  readonly expired: ReadonlyArray<string>;
}

/**
 * Where a notification leaves the server. `UserNotifications` owns the inbox and the device list
 * and hands each push-worthy notification to this adapter; it never fails (a device that cannot be
 * reached is reported, not raised). Web Push is the only adapter today; a native or relay one is
 * another layer of this tag.
 */
export class NotificationDelivery extends Context.Service<
  NotificationDelivery,
  {
    /** VAPID application server key, base64url, which a browser needs to subscribe. */
    readonly publicKey: string;
    readonly deliver: (
      notification: UserNotification,
      devices: ReadonlyArray<PushDevice>,
    ) => Effect.Effect<DeliveryReport>;
  }
>()("t3/notifications/NotificationDelivery") {}
