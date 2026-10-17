import type { UserNotificationPushSubscribeInput } from "@t3tools/contracts";

import { isElectron } from "./env";
import {
  base64UrlToBytes,
  computePushCapability,
  isIosDevice,
  pushDeviceLabel,
  resolveNotificationLink,
  subscriptionMatchesKey,
  type PushCapability,
} from "./pushNotifications.logic";

/**
 * Browser half of push to the owner. `/sw.js` only shows pushes and routes taps; everything
 * here is guarded so a missing API (tests, old browsers, the desktop shell) is a no-op.
 */

const SERVICE_WORKER_URL = "/sw.js";
const OPEN_MESSAGE_TYPE = "t3-notification-open";

function canUseServiceWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !isElectron
  );
}

export function registerPushServiceWorker(): void {
  if (!canUseServiceWorker()) return;
  void navigator.serviceWorker.register(SERVICE_WORKER_URL).catch((error: unknown) => {
    console.warn("Could not register the notification service worker.", error);
  });
}

/** Follows a notification link: in-app paths through the router history, URLs as new pages. */
export function followNotificationLink(
  link: string | null | undefined,
  history: { readonly push: (path: string) => void },
): void {
  const target = resolveNotificationLink(link, window.location.origin);
  if (target.kind === "in-app") history.push(target.path);
  else if (target.kind === "external") window.open(target.url, "_blank", "noopener");
}

/** Routes a tap on a system notification (relayed by the service worker) into the app. */
export function listenForNotificationOpen(history: {
  readonly push: (path: string) => void;
}): void {
  if (!canUseServiceWorker()) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const message = data as { type?: unknown; link?: unknown };
    if (message.type !== OPEN_MESSAGE_TYPE || typeof message.link !== "string") return;
    followNotificationLink(message.link, history);
  });
}

async function readRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) return null;
  try {
    // `ready` never settles when nothing registered the worker yet, so make sure one did.
    if (!(await navigator.serviceWorker.getRegistration())) {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    }
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export interface PushDeviceState {
  readonly capability: PushCapability;
  /** The browser's current subscription, if any. */
  readonly subscription: PushSubscription | null;
}

export async function readPushDeviceState(): Promise<PushDeviceState> {
  const supportsApis = canUseServiceWorker() && "PushManager" in window;
  const registration = supportsApis ? await readRegistration() : null;
  let subscription: PushSubscription | null = null;
  try {
    subscription = (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    subscription = null;
  }
  const capability = computePushCapability({
    isElectron,
    isSecureContext: window.isSecureContext,
    hasServiceWorker: registration !== null,
    hasPushManager: supportsApis,
    hasNotification: typeof Notification !== "undefined",
    isIos: isIosDevice({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
    isStandalone: isStandalone(),
    permission: typeof Notification === "undefined" ? null : Notification.permission,
    subscribed: subscription !== null,
  });
  return { capability, subscription };
}

function toSubscribeInput(
  subscription: PushSubscription,
): UserNotificationPushSubscribeInput | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    label: pushDeviceLabel(navigator.userAgent),
  };
}

/** A subscription made for another server key cannot be reused: drop it, it is dead anyway. */
async function subscribeWithKey(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (subscriptionMatchesKey(existing.options.applicationServerKey, publicKey)) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
}

export type EnablePushResult =
  | { readonly kind: "subscribed"; readonly input: UserNotificationPushSubscribeInput }
  | { readonly kind: "denied" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Asks for permission and subscribes this device. Call it straight from a click handler: the
 * permission prompt has to start inside the user gesture, so nothing may be awaited before it.
 */
export async function enablePushOnThisDevice(publicKey: string): Promise<EnablePushResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { kind: "denied" };
    const registration = await readRegistration();
    if (!registration) return { kind: "failed", message: "Servis çalışanı kaydedilemedi." };
    const subscription = await subscribeWithKey(registration, publicKey);
    const input = toSubscribeInput(subscription);
    if (!input) return { kind: "failed", message: "Tarayıcı abonelik anahtarı vermedi." };
    return { kind: "subscribed", input };
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Drops this device's subscription and returns its endpoint for the server to forget. */
export async function disablePushOnThisDevice(): Promise<string | null> {
  const { subscription } = await readPushDeviceState();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    // The server drops the device either way; a stale browser subscription only expires.
  }
  return endpoint;
}

/**
 * On app start with permission granted: the subscription to report to the server, replacing
 * one that belongs to a regenerated server key. Null when this device is not subscribed (an
 * opt-out stays an opt-out) or the browser cannot say.
 */
export async function currentSubscriptionForServer(
  publicKey: string,
): Promise<UserNotificationPushSubscribeInput | null> {
  const { capability, subscription } = await readPushDeviceState();
  if (capability !== "granted-subscribed" || !subscription) return null;
  try {
    if (subscriptionMatchesKey(subscription.options.applicationServerKey, publicKey)) {
      return toSubscribeInput(subscription);
    }
    const registration = await readRegistration();
    if (!registration) return null;
    return toSubscribeInput(await subscribeWithKey(registration, publicKey));
  } catch {
    return null;
  }
}
