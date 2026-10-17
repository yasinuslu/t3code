// Push-only service worker: shows the server's Web Push messages and routes taps.
// No fetch handler and no caching on purpose; the app itself never goes through here.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(event) {
  try {
    const parsed = event.data ? event.data.json() : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// A push must always end in a visible notification (Safari revokes the subscription otherwise),
// so a malformed payload still shows a generic one.
self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  const urgent = payload.priority === "urgent";
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : undefined;
  const title = typeof payload.title === "string" && payload.title ? payload.title : "T3 Code";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === "string" ? payload.body : "",
      tag,
      // A browser throws on `renotify` without a tag.
      renotify: urgent && tag !== undefined,
      requireInteraction: urgent,
      icon: "/icon-192.png",
      badge: "/favicon-32x32.png",
      data: {
        link: typeof payload.link === "string" ? payload.link : null,
        id: typeof payload.id === "string" ? payload.id : null,
      },
    }),
  );
});

async function openLink(link) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const isInApp = typeof link === "string" && link.startsWith("/") && !link.startsWith("//");
  const isExternal = typeof link === "string" && /^https?:\/\//i.test(link);

  if (isExternal) {
    await self.clients.openWindow(link);
    return;
  }

  const target = windows.find((client) => "focus" in client);
  if (target) {
    const focused = await target.focus();
    if (isInApp) (focused || target).postMessage({ type: "t3-notification-open", link });
    return;
  }
  await self.clients.openWindow(isInApp ? link : "/");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data ? event.notification.data.link : null;
  event.waitUntil(openLink(link));
});
