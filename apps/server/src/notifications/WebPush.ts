// @effect-diagnostics nodeBuiltinImport:off -- Web Push is ECDH, HKDF and AES-GCM over node:crypto.
/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and `aes128gcm` payload encryption (RFC 8188 and
 * 8291), the way a home-screen PWA on iOS 16.4+ and every Chromium and Firefox receive pushes
 * without any vendor account. The pure functions are exported for the RFC vector test; the layer
 * is the `NotificationDelivery` adapter.
 */
import * as NodeCrypto from "node:crypto";

import type { UserNotification } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  type DeliveryReport,
  NotificationDelivery,
  type PushDevice,
} from "./NotificationDelivery.ts";

const VAPID_SECRET = "web-push-vapid";
/** Push services require a contact in `sub`; Apple rejects a malformed one. */
const VAPID_SUBJECT = "mailto:push@t3.codes";
const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const RECORD_SIZE = 4096;
const SEND_TIMEOUT_MS = 10_000;
/** How long a push service keeps a message for a device that is offline. */
const TTL_SECONDS = { urgent: 24 * 60 * 60, normal: 60 * 60 } as const;

export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const fromBase64Url = (text: string): Buffer => Buffer.from(text, "base64url");

const VapidKey = Schema.Struct({
  kty: Schema.Literal("EC"),
  crv: Schema.Literal("P-256"),
  x: Schema.String,
  y: Schema.String,
  d: Schema.String,
});
type VapidKey = typeof VapidKey.Type;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const VapidKeyJson = Schema.fromJsonString(VapidKey);
const decodeVapidKey = Schema.decodeUnknownOption(VapidKeyJson);
const encodeVapidKey = Schema.encodeSync(VapidKeyJson);

export function generateVapidKey(): VapidKey {
  const { privateKey } = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!, d: jwk.d! };
}

/** The uncompressed point `pushManager.subscribe` wants as `applicationServerKey`. */
export const vapidPublicKey = (key: VapidKey): string =>
  toBase64Url(Buffer.concat([Buffer.from([4]), fromBase64Url(key.x), fromBase64Url(key.y)]));

/** The `Authorization` header that proves the sender to the push service of `endpoint`. */
export function vapidAuthorization(input: {
  readonly endpoint: string;
  readonly key: VapidKey;
  readonly nowMs: number;
}): string {
  const encode = (value: unknown) => Buffer.from(encodeJson(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(input.endpoint).origin,
    exp: Math.floor(input.nowMs / 1000) + VAPID_TOKEN_LIFETIME_SECONDS,
    sub: VAPID_SUBJECT,
  })}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(unsigned), {
    key: NodeCrypto.createPrivateKey({ key: input.key, format: "jwk" }),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${vapidPublicKey(input.key)}`;
}

/**
 * The request body for one device (RFC 8291). `salt` and `senderPrivateKey` exist for the RFC's
 * test vector; callers leave them out and get fresh random values.
 */
export function encryptPayload(input: {
  readonly plaintext: Uint8Array;
  readonly p256dh: string;
  readonly auth: string;
  readonly salt?: Uint8Array;
  readonly senderPrivateKey?: Uint8Array;
}): Buffer {
  const receiverPublic = fromBase64Url(input.p256dh);
  const authSecret = fromBase64Url(input.auth);
  const sender = NodeCrypto.createECDH("prime256v1");
  if (input.senderPrivateKey === undefined) sender.generateKeys();
  else sender.setPrivateKey(Buffer.from(input.senderPrivateKey));
  const senderPublic = sender.getPublicKey();
  const salt = input.salt === undefined ? NodeCrypto.randomBytes(16) : Buffer.from(input.salt);

  const sharedSecret = sender.computeSecret(receiverPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic]);
  const ikm = Buffer.from(NodeCrypto.hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(
    NodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    NodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  // One record: the data, then the 0x02 delimiter that marks the last record.
  const cipher = NodeCrypto.createCipheriv("aes-128-gcm", contentKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(input.plaintext), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21 + senderPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  senderPublic.copy(header, 21);
  return Buffer.concat([header, encrypted]);
}

/** Same notification, same slot at the push service: a later one replaces an undelivered one. */
const topicOf = (notification: UserNotification): string | undefined =>
  notification.tag === undefined
    ? undefined
    : NodeCrypto.createHash("sha256").update(notification.tag).digest("base64url").slice(0, 32);

/** What the service worker receives; it decides how to show it. */
const pushPayloadOf = (notification: UserNotification) => ({
  id: notification.id,
  title: notification.title,
  body: notification.body,
  link: notification.link ?? null,
  priority: notification.priority,
  // A browser only accepts `renotify` on a notification that has a tag.
  tag: notification.tag ?? notification.id,
  createdAt: notification.createdAt,
});

export const layer = Layer.effect(
  NotificationDelivery,
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const http = yield* HttpClient.HttpClient;

    const stored = yield* secrets.get(VAPID_SECRET);
    const existing = Option.flatMap(stored, (bytes) =>
      decodeVapidKey(new TextDecoder().decode(bytes)),
    );
    const key = Option.isSome(existing) ? existing.value : generateVapidKey();
    if (Option.isNone(existing)) {
      yield* secrets.set(VAPID_SECRET, new TextEncoder().encode(encodeVapidKey(key)));
    }

    const sendOne = (
      notification: UserNotification,
      body: Uint8Array,
      device: PushDevice,
    ): Effect.Effect<"accepted" | "expired" | "failed"> =>
      Effect.gen(function* () {
        const topic = topicOf(notification);
        const nowMs = yield* Clock.currentTimeMillis;
        const request = HttpClientRequest.post(device.endpoint).pipe(
          HttpClientRequest.setHeaders({
            "Content-Encoding": "aes128gcm",
            Authorization: vapidAuthorization({
              endpoint: device.endpoint,
              key,
              nowMs,
            }),
            TTL: String(
              notification.priority === "urgent" ? TTL_SECONDS.urgent : TTL_SECONDS.normal,
            ),
            Urgency: notification.priority === "urgent" ? "high" : "normal",
            ...(topic === undefined ? {} : { Topic: topic }),
          }),
          HttpClientRequest.bodyUint8Array(body, "application/octet-stream"),
        );
        const response = yield* http.execute(request).pipe(Effect.timeout(SEND_TIMEOUT_MS));
        if (response.status >= 200 && response.status < 300) return "accepted" as const;
        // 404 and 410 are the push service saying this subscription will never work again.
        if (response.status === 404 || response.status === 410) return "expired" as const;
        yield* Effect.logWarning("web push rejected", {
          status: response.status,
          host: new URL(device.endpoint).host,
        });
        return "failed" as const;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("web push failed", {
            host: new URL(device.endpoint).host,
            cause,
          }).pipe(Effect.as("failed" as const)),
        ),
      );

    const deliver: NotificationDelivery["Service"]["deliver"] = (notification, devices) =>
      Effect.gen(function* () {
        const plaintext = new TextEncoder().encode(encodeJson(pushPayloadOf(notification)));
        const outcomes = yield* Effect.forEach(
          devices,
          (device) =>
            sendOne(
              notification,
              encryptPayload({ plaintext, p256dh: device.p256dh, auth: device.auth }),
              device,
            ),
          { concurrency: 8 },
        );
        return {
          accepted: outcomes.filter((outcome) => outcome === "accepted").length,
          expired: devices
            .filter((_, index) => outcomes[index] === "expired")
            .map((device) => device.endpoint),
        } satisfies DeliveryReport;
      });

    return NotificationDelivery.of({ publicKey: vapidPublicKey(key), deliver });
  }),
);
