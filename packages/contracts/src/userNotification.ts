import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A message to the owner, whichever client they are on. Anything that can reach the server (an
 * agent through MCP, a scheduled task, `t3 notify`, the web app) sends one; the server keeps it in
 * an inbox and, by priority, pushes it to their devices.
 *
 * - `urgent`: needs them now (a flag, "needs you"). Pushed, and re-alerts when it replaces a
 *   notification with the same tag.
 * - `normal`: finished work worth a glance. Pushed.
 * - `quiet`: inbox only, never pushed.
 */
export const UserNotificationPriority = Schema.Literals(["urgent", "normal", "quiet"]);
export type UserNotificationPriority = typeof UserNotificationPriority.Type;

const USER_NOTIFICATION_TITLE_MAX = 120;
const USER_NOTIFICATION_BODY_MAX = 600;
const USER_NOTIFICATION_LINK_MAX = 2048;
const USER_NOTIFICATION_TAG_MAX = 120;

export const UserNotificationInput = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(USER_NOTIFICATION_TITLE_MAX)).annotate({
    description: "Headline, one short line.",
  }),
  body: Schema.String.check(Schema.isMaxLength(USER_NOTIFICATION_BODY_MAX)).annotate({
    description: "One or two plain sentences. Empty is allowed.",
  }),
  link: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(USER_NOTIFICATION_LINK_MAX)).annotate({
      description:
        "Where a tap goes: an https URL, or an in-app path such as /<environmentId>/<threadId>.",
    }),
  ),
  priority: Schema.optional(UserNotificationPriority).annotate({
    description: "Defaults to normal.",
  }),
  tag: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(USER_NOTIFICATION_TAG_MAX)).annotate({
      description:
        "Collapses repeats: a later notification with the same tag replaces the earlier one in the inbox and on the device.",
    }),
  ),
});
export type UserNotificationInput = typeof UserNotificationInput.Type;

export const UserNotification = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  body: Schema.String,
  link: Schema.optional(Schema.String),
  priority: UserNotificationPriority,
  tag: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  /** Unset while unread. */
  readAt: Schema.optional(IsoDateTime),
});
export type UserNotification = typeof UserNotification.Type;

export const UserNotificationsState = Schema.Struct({
  /** Newest first, capped. */
  items: Schema.Array(UserNotification),
  unreadCount: Schema.Int,
  push: Schema.Struct({
    /** VAPID application server key, base64url, for `pushManager.subscribe`. */
    publicKey: Schema.String,
    /** Devices that currently receive pushes. */
    deviceCount: Schema.Int,
  }),
});
export type UserNotificationsState = typeof UserNotificationsState.Type;

export const UserNotificationNotifyResult = Schema.Struct({
  notification: UserNotification,
  /** Identical to the notification already held under the tag, so nothing was stored or pushed. */
  deduped: Schema.Boolean,
  /** Devices the push was accepted for. */
  pushed: Schema.Int,
});
export type UserNotificationNotifyResult = typeof UserNotificationNotifyResult.Type;

export const UserNotificationMarkReadInput = Schema.Struct({
  /** Omit to mark everything read. */
  ids: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type UserNotificationMarkReadInput = typeof UserNotificationMarkReadInput.Type;

export const UserNotificationMarkReadResult = Schema.Struct({ unreadCount: Schema.Int });
export type UserNotificationMarkReadResult = typeof UserNotificationMarkReadResult.Type;

/** A browser `PushSubscription` as `toJSON()` gives it. */
export const UserNotificationPushSubscribeInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  keys: Schema.Struct({
    p256dh: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
    auth: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  }),
  /** Shown to help tell devices apart. */
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
});
export type UserNotificationPushSubscribeInput = typeof UserNotificationPushSubscribeInput.Type;

export const UserNotificationPushUnsubscribeInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
});
export type UserNotificationPushUnsubscribeInput = typeof UserNotificationPushUnsubscribeInput.Type;

export const UserNotificationPushResult = Schema.Struct({ deviceCount: Schema.Int });
export type UserNotificationPushResult = typeof UserNotificationPushResult.Type;

export class UserNotificationError extends Schema.TaggedError<UserNotificationError>()(
  "UserNotificationError",
  {
    /** `invalid_input` is the caller's to fix; `storage_failed` is the server's. */
    reason: Schema.Literals(["invalid_input", "storage_failed"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
