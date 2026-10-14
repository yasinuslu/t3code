/**
 * Pure rules behind "push to the owner": what this browser can do, how a notification's link
 * is followed, and the small string/byte helpers the enable flow needs. The browser-facing half
 * is `pushNotifications.ts`.
 */

export const NEEDS_INSTALL_HINT =
  "iPhone'da önce Paylaş > Ana Ekrana Ekle, sonra uygulamayı ana ekrandan aç.";

export type PushCapability =
  /** No service worker or Push API here (or the desktop shell, which has no push service). */
  | "unsupported"
  /** iPhone/iPad Safari only exposes push to an installed (standalone) web app. */
  | "needs-install"
  | "denied"
  | "default"
  | "granted-not-subscribed"
  | "granted-subscribed";

export interface PushEnvironmentFacts {
  readonly isElectron: boolean;
  readonly isSecureContext: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasPushManager: boolean;
  readonly hasNotification: boolean;
  readonly isIos: boolean;
  readonly isStandalone: boolean;
  /** `Notification.permission`, or null when the API is missing. */
  readonly permission: NotificationPermission | null;
  /** The service worker registration holds a push subscription. */
  readonly subscribed: boolean;
}

export function computePushCapability(facts: PushEnvironmentFacts): PushCapability {
  if (facts.isElectron || !facts.isSecureContext) return "unsupported";
  // Checked before the API probes: iOS hides PushManager until the app is installed.
  if (facts.isIos && !facts.isStandalone) return "needs-install";
  if (
    !facts.hasServiceWorker ||
    !facts.hasPushManager ||
    !facts.hasNotification ||
    facts.permission === null
  ) {
    return "unsupported";
  }
  if (facts.permission === "denied") return "denied";
  if (facts.permission === "default") return "default";
  return facts.subscribed ? "granted-subscribed" : "granted-not-subscribed";
}

/** Whether the one-time prompt has something to offer. */
export function pushPromptKind(capability: PushCapability): "enable" | "install" | null {
  if (capability === "default") return "enable";
  if (capability === "needs-install") return "install";
  return null;
}

export function pushCapabilityHint(capability: PushCapability): string {
  switch (capability) {
    case "unsupported":
      return "Bu tarayıcı bildirim göndermeyi desteklemiyor.";
    case "needs-install":
      return NEEDS_INSTALL_HINT;
    case "denied":
      return "Bildirimler tarayıcı ayarlarında engellenmiş. Ayarlardan izin verip tekrar dene.";
    case "default":
      return "Telefona ve bilgisayara anında bildirim gelsin.";
    case "granted-not-subscribed":
      return "İzin verildi ama bu cihaz henüz kayıtlı değil.";
    case "granted-subscribed":
      return "Bu cihaz bildirim alıyor.";
  }
}

export function isIosDevice(input: {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
}): boolean {
  if (/iPhone|iPad|iPod/.test(input.userAgent)) return true;
  // iPadOS reports itself as a Mac; only the touch screen tells them apart.
  return input.platform === "MacIntel" && input.maxTouchPoints > 1;
}

/** `PushManager.subscribe` wants the VAPID key as bytes; the server hands it over base64url. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Whether an existing subscription was made for this server key (it is fixed per subscription). */
export function subscriptionMatchesKey(
  subscriptionKey: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!subscriptionKey) return false;
  const have = new Uint8Array(subscriptionKey);
  let want: Uint8Array;
  try {
    want = base64UrlToBytes(publicKey);
  } catch {
    return false;
  }
  return have.length === want.length && have.every((byte, index) => byte === want[index]);
}

/** A short device name for the server's device list, e.g. "Safari · iPhone". */
export function pushDeviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Tarayıcı";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(userAgent)
            ? "Mac"
            : /Linux|X11/.test(userAgent)
              ? "Linux"
              : "";
  return device ? `${browser} · ${device}` : browser;
}

export type NotificationLinkTarget =
  | { readonly kind: "in-app"; readonly path: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "none" };

/**
 * An in-app link is a path such as `/<environmentId>/<threadId>`; an http(s) link to this same
 * origin counts as in-app; any other http(s) link opens as a normal page.
 */
export function resolveNotificationLink(
  link: string | null | undefined,
  currentOrigin: string,
): NotificationLinkTarget {
  const value = link?.trim();
  if (!value) return { kind: "none" };
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return { kind: "in-app", path: value };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "none" };
    if (url.origin === currentOrigin) {
      return { kind: "in-app", path: `${url.pathname}${url.search}${url.hash}` };
    }
    return { kind: "external", url: url.href };
  } catch {
    return { kind: "none" };
  }
}

/** Turkish short relative time for the inbox: "şimdi", "5 dk", "3 sa", "2 g". */
export function formatInboxTime(isoDate: string, nowMs: number): string {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (seconds < 60) return "şimdi";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa`;
  return `${Math.floor(hours / 24)} g`;
}
