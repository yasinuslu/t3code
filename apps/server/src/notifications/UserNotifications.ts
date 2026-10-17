/**
 * The owner's inbox and push channel. Anything that can reach the server sends a message here
 * (`notify`); it is stored, shown in the web app's inbox, and by priority pushed to the devices
 * that subscribed. Inbox items persist in `notifications.json` in the state directory, capped;
 * devices live in the secrets store because an endpoint plus its keys is enough to push to a
 * person.
 */
import {
  type UserNotification,
  UserNotification as UserNotificationSchema,
  UserNotificationError,
  type UserNotificationInput,
  type UserNotificationMarkReadInput,
  type UserNotificationMarkReadResult,
  type UserNotificationNotifyResult,
  type UserNotificationPushResult,
  type UserNotificationPushSubscribeInput,
  type UserNotificationsState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { NotificationDelivery, type PushDevice } from "./NotificationDelivery.ts";

/** The inbox keeps this many, newest first. */
const MAX_INBOX_ITEMS = 200;
const INBOX_FILE = "notifications.json";
const DEVICES_SECRET = "web-push-devices";

const InboxFile = Schema.Struct({ items: Schema.Array(UserNotificationSchema) });
const decodeInbox = Schema.decodeUnknownOption(Schema.fromJsonString(InboxFile));
const encodeInbox = Schema.encodeSync(Schema.fromJsonString(InboxFile));

const PushDeviceSchema = Schema.Struct({
  endpoint: Schema.String,
  p256dh: Schema.String,
  auth: Schema.String,
  label: Schema.optional(Schema.String),
  createdAt: Schema.String,
});
const DevicesJson = Schema.fromJsonString(Schema.Array(PushDeviceSchema));
const decodeDevices = Schema.decodeUnknownOption(DevicesJson);
const encodeDevices = Schema.encodeSync(DevicesJson);

/** An in-app path (`/env/thread`) or an http(s) URL; anything else could run script. */
function isAcceptableLink(link: string): boolean {
  if (link.startsWith("/")) return !link.startsWith("//") && !link.includes("\\");
  try {
    const protocol = new URL(link).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const sameContent = (a: UserNotification, b: UserNotification) =>
  a.title === b.title && a.body === b.body && a.link === b.link && a.priority === b.priority;

export class UserNotifications extends Context.Service<
  UserNotifications,
  {
    /** Stores the notification and, unless quiet, pushes it to every subscribed device. */
    readonly notify: (
      input: UserNotificationInput,
    ) => Effect.Effect<UserNotificationNotifyResult, UserNotificationError>;
    readonly state: Effect.Effect<UserNotificationsState>;
    /** Current state first, then every change. */
    readonly changes: Stream.Stream<UserNotificationsState>;
    readonly markRead: (
      input: UserNotificationMarkReadInput,
    ) => Effect.Effect<UserNotificationMarkReadResult, UserNotificationError>;
    /** Adds or refreshes a device, keyed by endpoint. */
    readonly subscribeDevice: (
      input: UserNotificationPushSubscribeInput,
    ) => Effect.Effect<UserNotificationPushResult, UserNotificationError>;
    readonly unsubscribeDevice: (
      endpoint: string,
    ) => Effect.Effect<UserNotificationPushResult, UserNotificationError>;
  }
>()("t3/notifications/UserNotifications") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const delivery = yield* NotificationDelivery;

  const inboxPath = path.join(config.stateDir, INBOX_FILE);
  const initialItems = yield* fileSystem.readFileString(inboxPath).pipe(
    Effect.map((text) =>
      Option.match(decodeInbox(text), { onSome: (file) => file.items, onNone: () => [] }),
    ),
    Effect.orElseSucceed((): ReadonlyArray<UserNotification> => []),
  );
  const initialDevices = yield* secrets.get(DEVICES_SECRET).pipe(
    Effect.map((stored) =>
      Option.flatMap(stored, (bytes) => decodeDevices(new TextDecoder().decode(bytes))).pipe(
        Option.getOrElse((): ReadonlyArray<PushDevice> => []),
      ),
    ),
    Effect.orElseSucceed((): ReadonlyArray<PushDevice> => []),
  );

  const itemsRef = yield* Ref.make<ReadonlyArray<UserNotification>>(initialItems);
  const devicesRef = yield* Ref.make<ReadonlyArray<PushDevice>>(initialDevices);
  const writeLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<UserNotificationsState>(16);

  const failure = (message: string) => (cause: unknown) =>
    new UserNotificationError({ reason: "storage_failed", message, cause });

  const currentState = Effect.gen(function* () {
    const items = yield* Ref.get(itemsRef);
    const devices = yield* Ref.get(devicesRef);
    return {
      items,
      unreadCount: items.filter((item) => item.readAt === undefined).length,
      push: { publicKey: delivery.publicKey, deviceCount: devices.length },
    } satisfies UserNotificationsState;
  });

  const saveItems = (items: ReadonlyArray<UserNotification>) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(inboxPath), { recursive: true });
      const temp = `${inboxPath}.${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}.tmp`;
      yield* fileSystem.writeFileString(temp, `${encodeInbox({ items })}\n`);
      yield* fileSystem.rename(temp, inboxPath);
    }).pipe(Effect.mapError(failure("Could not save the notification inbox.")));

  const saveDevices = (devices: ReadonlyArray<PushDevice>) =>
    secrets
      .set(DEVICES_SECRET, new TextEncoder().encode(encodeDevices(devices)))
      .pipe(Effect.mapError(failure("Could not save the push devices.")));

  const publish = Effect.flatMap(currentState, (state) => PubSub.publish(changes, state));

  const writeItems = (items: ReadonlyArray<UserNotification>) =>
    Effect.gen(function* () {
      yield* saveItems(items);
      yield* Ref.set(itemsRef, items);
      yield* publish;
    });

  const writeDevices = (devices: ReadonlyArray<PushDevice>) =>
    Effect.gen(function* () {
      yield* saveDevices(devices);
      yield* Ref.set(devicesRef, devices);
      yield* publish;
      return { deviceCount: devices.length } satisfies UserNotificationPushResult;
    });

  const notify: UserNotifications["Service"]["notify"] = (input) =>
    Effect.gen(function* () {
      if (input.link !== undefined && !isAcceptableLink(input.link)) {
        return yield* new UserNotificationError({
          reason: "invalid_input",
          message: "link must be an https URL or an in-app path starting with /.",
        });
      }
      const priority = input.priority ?? "normal";
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const stored = yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          const items = yield* Ref.get(itemsRef);
          const earlier =
            input.tag === undefined ? undefined : items.find((item) => item.tag === input.tag);
          const notification: UserNotification = {
            id: earlier?.id ?? (yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
            title: input.title,
            body: input.body,
            priority,
            createdAt,
            ...(input.link === undefined ? {} : { link: input.link }),
            ...(input.tag === undefined ? {} : { tag: input.tag }),
          };
          // The same message again under the same tag is a repeat, not news.
          if (earlier !== undefined && sameContent(earlier, notification)) {
            return { notification: earlier, deduped: true };
          }
          yield* writeItems(
            [notification, ...items.filter((item) => item.id !== notification.id)].slice(
              0,
              MAX_INBOX_ITEMS,
            ),
          );
          return { notification, deduped: false };
        }),
      );
      if (stored.deduped || priority === "quiet") return { ...stored, pushed: 0 };

      const devices = yield* Ref.get(devicesRef);
      if (devices.length === 0) return { ...stored, pushed: 0 };
      const report = yield* delivery.deliver(stored.notification, devices);
      if (report.expired.length > 0) {
        yield* writeLock.withPermits(1)(
          Effect.gen(function* () {
            const expired = new Set(report.expired);
            const remaining = (yield* Ref.get(devicesRef)).filter(
              (device) => !expired.has(device.endpoint),
            );
            yield* writeDevices(remaining);
          }),
        );
      }
      return { ...stored, pushed: report.accepted };
    });

  const markRead: UserNotifications["Service"]["markRead"] = (input) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const readAt = DateTime.formatIso(yield* DateTime.now);
        const ids = input.ids === undefined ? undefined : new Set(input.ids);
        const items = yield* Ref.get(itemsRef);
        const next = items.map((item) =>
          item.readAt === undefined && (ids === undefined || ids.has(item.id))
            ? { ...item, readAt }
            : item,
        );
        const changed = next.some((item, index) => item !== items[index]);
        if (changed) yield* writeItems(next);
        return { unreadCount: next.filter((item) => item.readAt === undefined).length };
      }),
    );

  const subscribeDevice: UserNotifications["Service"]["subscribeDevice"] = (input) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const existing = (yield* Ref.get(devicesRef)).find(
          (device) => device.endpoint === input.endpoint,
        );
        const device: PushDevice = {
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          createdAt: existing?.createdAt ?? DateTime.formatIso(yield* DateTime.now),
          ...(input.label === undefined ? {} : { label: input.label }),
        };
        const others = (yield* Ref.get(devicesRef)).filter(
          (candidate) => candidate.endpoint !== input.endpoint,
        );
        return yield* writeDevices([...others, device]);
      }),
    );

  const unsubscribeDevice: UserNotifications["Service"]["unsubscribeDevice"] = (endpoint) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const devices = yield* Ref.get(devicesRef);
        if (!devices.some((device) => device.endpoint === endpoint)) {
          return { deviceCount: devices.length };
        }
        return yield* writeDevices(devices.filter((device) => device.endpoint !== endpoint));
      }),
    );

  const stream: UserNotifications["Service"]["changes"] = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const first = yield* currentState;
      return Stream.concat(Stream.make(first), Stream.fromSubscription(subscription));
    }),
  );

  return UserNotifications.of({
    notify,
    state: currentState,
    changes: stream,
    markRead,
    subscribeDevice,
    unsubscribeDevice,
  });
});

export const layer = Layer.effect(UserNotifications, make);
