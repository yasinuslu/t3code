import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlToBytes,
  computePushCapability,
  formatInboxTime,
  isIosDevice,
  pushDeviceLabel,
  pushPromptKind,
  resolveNotificationLink,
  subscriptionMatchesKey,
  type PushEnvironmentFacts,
} from "./pushNotifications.logic";

const capable: PushEnvironmentFacts = {
  isElectron: false,
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIos: false,
  isStandalone: false,
  permission: "default",
  subscribed: false,
};

describe("computePushCapability", () => {
  it("walks the permission and subscription states", () => {
    expect(computePushCapability(capable)).toBe("default");
    expect(computePushCapability({ ...capable, permission: "denied" })).toBe("denied");
    expect(computePushCapability({ ...capable, permission: "granted" })).toBe(
      "granted-not-subscribed",
    );
    expect(computePushCapability({ ...capable, permission: "granted", subscribed: true })).toBe(
      "granted-subscribed",
    );
  });

  it("is unsupported without the APIs, off HTTPS, and in the desktop shell", () => {
    expect(computePushCapability({ ...capable, hasPushManager: false })).toBe("unsupported");
    expect(computePushCapability({ ...capable, hasServiceWorker: false })).toBe("unsupported");
    expect(computePushCapability({ ...capable, permission: null })).toBe("unsupported");
    expect(computePushCapability({ ...capable, isSecureContext: false })).toBe("unsupported");
    expect(computePushCapability({ ...capable, isElectron: true })).toBe("unsupported");
  });

  it("asks iOS Safari to install the app first, even though it hides PushManager there", () => {
    const ios = { ...capable, isIos: true, hasPushManager: false, hasNotification: false };
    expect(computePushCapability({ ...ios, permission: null })).toBe("needs-install");
    expect(computePushCapability({ ...capable, isIos: true, isStandalone: true })).toBe("default");
  });
});

describe("pushPromptKind", () => {
  it("offers push only when it is possible and undecided", () => {
    expect(pushPromptKind("default")).toBe("enable");
    expect(pushPromptKind("needs-install")).toBe("install");
    expect(pushPromptKind("denied")).toBeNull();
    expect(pushPromptKind("granted-subscribed")).toBeNull();
    expect(pushPromptKind("unsupported")).toBeNull();
  });
});

describe("isIosDevice", () => {
  it("detects iPhone and an iPad that reports itself as a Mac", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});

describe("base64UrlToBytes", () => {
  it("decodes unpadded base64url", () => {
    expect([...base64UrlToBytes("-_8")]).toEqual([251, 255]);
    expect([...base64UrlToBytes("AQID")]).toEqual([1, 2, 3]);
  });
});

describe("subscriptionMatchesKey", () => {
  const key = new Uint8Array([1, 2, 3]).buffer;
  it("compares the stored key with the server's", () => {
    expect(subscriptionMatchesKey(key, "AQID")).toBe(true);
    expect(subscriptionMatchesKey(key, "AQIE")).toBe(false);
    expect(subscriptionMatchesKey(null, "AQID")).toBe(false);
  });
});

describe("resolveNotificationLink", () => {
  const origin = "https://t3.example.org";
  it("keeps in-app paths and same-origin URLs in the app", () => {
    expect(resolveNotificationLink("/env-1/thread-2", origin)).toEqual({
      kind: "in-app",
      path: "/env-1/thread-2",
    });
    expect(resolveNotificationLink("https://t3.example.org/a/b?x=1#h", origin)).toEqual({
      kind: "in-app",
      path: "/a/b?x=1#h",
    });
  });

  it("opens other http(s) URLs as pages and ignores everything else", () => {
    expect(resolveNotificationLink("https://example.com/pr/1", origin)).toEqual({
      kind: "external",
      url: "https://example.com/pr/1",
    });
    expect(resolveNotificationLink("//evil.example/x", origin)).toEqual({ kind: "none" });
    expect(resolveNotificationLink("javascript:alert(1)", origin)).toEqual({ kind: "none" });
    expect(resolveNotificationLink("", origin)).toEqual({ kind: "none" });
    expect(resolveNotificationLink(null, origin)).toEqual({ kind: "none" });
  });
});

describe("formatInboxTime", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("is short and Turkish", () => {
    expect(formatInboxTime("2026-10-14T11:59:30Z", now)).toBe("şimdi");
    expect(formatInboxTime("2026-10-14T11:55:00Z", now)).toBe("5 dk");
    expect(formatInboxTime("2026-10-14T09:00:00Z", now)).toBe("3 sa");
    expect(formatInboxTime("2026-10-12T12:00:00Z", now)).toBe("2 g");
    expect(formatInboxTime("nope", now)).toBe("");
  });
});

describe("pushDeviceLabel", () => {
  it("names browser and device", () => {
    expect(
      pushDeviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari · iPhone");
    expect(
      pushDeviceLabel(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      ),
    ).toBe("Chrome · Linux");
  });
});
