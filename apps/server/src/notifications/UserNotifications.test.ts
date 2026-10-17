// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { layer as webPushLayer, toBase64Url } from "./WebPush.ts";
import * as UserNotifications from "./UserNotifications.ts";

let home = "";
beforeEach(() => {
  home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "notifications-home-"));
});
afterEach(() => {
  NodeFS.rmSync(home, { recursive: true, force: true });
});

interface SentPush {
  readonly endpoint: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}

/** A browser: the keys a PushSubscription holds, and the decryption a push service never sees. */
const makeDevice = (name: string) => {
  const ecdh = NodeCrypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = NodeCrypto.randomBytes(16);
  return {
    subscription: {
      endpoint: `https://push.example.test/${name}`,
      keys: { p256dh: toBase64Url(ecdh.getPublicKey()), auth: toBase64Url(auth) },
    },
    /** RFC 8291 section 4, the receiving side. */
    decrypt: (body: Uint8Array): { readonly title: string; readonly tag: string } => {
      const buffer = Buffer.from(body);
      const salt = buffer.subarray(0, 16);
      const keyLength = buffer.readUInt8(20);
      const senderPublic = buffer.subarray(21, 21 + keyLength);
      const ciphertext = buffer.subarray(21 + keyLength);
      const ikm = Buffer.from(
        NodeCrypto.hkdfSync(
          "sha256",
          ecdh.computeSecret(senderPublic),
          auth,
          Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), senderPublic]),
          32,
        ),
      );
      const key = Buffer.from(
        NodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
      );
      const nonce = Buffer.from(
        NodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
      );
      const decipher = NodeCrypto.createDecipheriv("aes-128-gcm", key, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const padded = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      return JSON.parse(padded.subarray(0, padded.length - 1).toString());
    },
  };
};

/** A push service that answers each endpoint with the status the test chose. */
const makePushService = (statusByEndpoint: Map<string, number> = new Map()) => {
  const sent: SentPush[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      sent.push({
        endpoint: request.url,
        headers: { ...request.headers } as Record<string, string>,
        body: request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array(),
      });
      return HttpClientResponse.fromWeb(
        request,
        new Response(null, { status: statusByEndpoint.get(request.url) ?? 201 }),
      );
    }),
  );
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const build = Effect.fn("buildUserNotifications")(function* (
  push: ReturnType<typeof makePushService>,
) {
  const base = ServerConfig.layerTest(home, home).pipe(Layer.provideMerge(NodeServices.layer));
  const withSecrets = ServerSecretStore.layer.pipe(Layer.provideMerge(base));
  const delivery = webPushLayer.pipe(Layer.provide(push.layer), Layer.provideMerge(withSecrets));
  const services = yield* Layer.build(
    UserNotifications.layer.pipe(Layer.provide(delivery), Layer.provideMerge(withSecrets)),
  );
  return Context.get(services, UserNotifications.UserNotifications);
});

describe("UserNotifications", () => {
  it.effect("keeps quiet notifications in the inbox and never pushes them", () =>
    Effect.gen(function* () {
      const push = makePushService();
      const notifications = yield* build(push);
      const device = makeDevice("phone");
      yield* notifications.subscribeDevice(device.subscription);

      const result = yield* notifications.notify({
        title: "Nightly done",
        body: "",
        priority: "quiet",
      });
      expect(result.pushed).toBe(0);
      expect(push.sent).toHaveLength(0);
      const state = yield* notifications.state;
      expect(state.items.map((item) => item.title)).toEqual(["Nightly done"]);
      expect(state.unreadCount).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("pushes normal and urgent notifications, encrypted, urgent with high urgency", () =>
    Effect.gen(function* () {
      const push = makePushService();
      const notifications = yield* build(push);
      const device = makeDevice("phone");
      yield* notifications.subscribeDevice(device.subscription);

      const normal = yield* notifications.notify({ title: "PR ready", body: "ok" });
      const urgent = yield* notifications.notify({
        title: "🚩 Bağ-Kur yapılandırma",
        body: "one line",
        link: "https://reports.example.test/r.html",
        priority: "urgent",
        tag: "flag:bag-kur:2026-10-14",
      });
      expect([normal.pushed, urgent.pushed]).toEqual([1, 1]);
      expect(push.sent.map((sent) => sent.headers["urgency"])).toEqual(["normal", "high"]);
      expect(push.sent[0]!.headers["authorization"]).toMatch(/^vapid t=.+, k=.+$/);
      const payload = device.decrypt(push.sent[1]!.body);
      expect(payload.title).toBe("🚩 Bağ-Kur yapılandırma");
      expect(payload.tag).toBe("flag:bag-kur:2026-10-14");
    }).pipe(Effect.scoped),
  );

  it.effect("collapses a repeated tag into one inbox item and skips identical repeats", () =>
    Effect.gen(function* () {
      const push = makePushService();
      const notifications = yield* build(push);
      yield* notifications.subscribeDevice(makeDevice("phone").subscription);

      const first = yield* notifications.notify({
        title: "Flag",
        body: "v1",
        priority: "urgent",
        tag: "flag:a",
      });
      const same = yield* notifications.notify({
        title: "Flag",
        body: "v1",
        priority: "urgent",
        tag: "flag:a",
      });
      expect(same.deduped).toBe(true);
      expect(push.sent).toHaveLength(1);

      const updated = yield* notifications.notify({
        title: "Flag",
        body: "v2",
        priority: "urgent",
        tag: "flag:a",
      });
      expect(updated.deduped).toBe(false);
      expect(updated.notification.id).toBe(first.notification.id);
      expect(push.sent).toHaveLength(2);
      const state = yield* notifications.state;
      expect(state.items.map((item) => item.body)).toEqual(["v2"]);
    }).pipe(Effect.scoped),
  );

  it.effect("forgets a device the push service reports gone and keeps one that just errored", () =>
    Effect.gen(function* () {
      const gone = makeDevice("gone");
      const flaky = makeDevice("flaky");
      const push = makePushService(
        new Map([
          [gone.subscription.endpoint, 410],
          [flaky.subscription.endpoint, 503],
        ]),
      );
      const notifications = yield* build(push);
      yield* notifications.subscribeDevice(gone.subscription);
      yield* notifications.subscribeDevice(flaky.subscription);
      expect((yield* notifications.state).push.deviceCount).toBe(2);

      const result = yield* notifications.notify({ title: "x", body: "", priority: "urgent" });
      expect(result.pushed).toBe(0);
      expect((yield* notifications.state).push.deviceCount).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects links that could run script", () =>
    Effect.gen(function* () {
      const notifications = yield* build(makePushService());
      const failure = yield* notifications
        .notify({ title: "x", body: "", link: "javascript:alert(1)" })
        .pipe(Effect.flip);
      expect(failure.reason).toBe("invalid_input");
      const ok = yield* notifications.notify({ title: "x", body: "", link: "/env/thread" });
      expect(ok.notification.link).toBe("/env/thread");
    }).pipe(Effect.scoped),
  );

  it.effect("marks read and keeps the inbox and devices across a restart", () =>
    Effect.gen(function* () {
      const push = makePushService();
      const before = yield* build(push);
      yield* before.subscribeDevice(makeDevice("phone").subscription);
      const a = yield* before.notify({ title: "a", body: "", priority: "quiet" });
      yield* before.notify({ title: "b", body: "", priority: "quiet" });
      const read = yield* before.markRead({ ids: [a.notification.id] });
      expect(read.unreadCount).toBe(1);

      const after = yield* build(push);
      const state = yield* after.state;
      expect(state.items.map((item) => item.title)).toEqual(["b", "a"]);
      expect(state.unreadCount).toBe(1);
      expect(state.push.deviceCount).toBe(1);
      expect((yield* after.markRead({})).unreadCount).toBe(0);
    }).pipe(Effect.scoped),
  );
});
