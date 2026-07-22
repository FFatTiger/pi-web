"use strict";

const CACHE_PREFIX = "pi-web-public-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/badge-96.png",
];
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match("/offline.html")) || new Response(
        "<!doctype html><title>Pi Agent Web</title><h1>You are offline</h1><p>Reconnect to continue.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      )
    ));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function ownKeysEqual(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parseNotificationPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== 1 || !boundedText(value.id, 128)) return null;
  if (value.kind === "test") {
    return ownKeysEqual(value, ["version", "id", "kind"])
      ? { version: 1, id: value.id, kind: "test" }
      : null;
  }
  if (value.kind === "agent") {
    if (!ownKeysEqual(value, ["version", "id", "kind", "sessionId", "result"])) return null;
    if (!boundedText(value.sessionId, 256)) return null;
    if (value.result !== "success" && value.result !== "error") return null;
    return {
      version: 1,
      id: value.id,
      kind: "agent",
      sessionId: value.sessionId,
      result: value.result,
    };
  }
  return null;
}

function getNotificationPresentation(payload) {
  if (payload.kind === "test") {
    return {
      title: "Pi Agent Web",
      body: "Test notification delivered",
      tag: "pi-web-test",
      url: "/",
    };
  }
  const encoded = encodeURIComponent(payload.sessionId);
  return {
    title: "Pi Agent Web",
    body: payload.result === "success" ? "Agent run finished" : "Agent run failed",
    tag: `pi-web-agent-${encoded}-${payload.result}`,
    url: `/?session=${encoded}`,
  };
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let raw;
    try {
      raw = event.data?.json();
    } catch {
      return;
    }
    const payload = parseNotificationPayload(raw);
    if (!payload) return;
    const view = getNotificationPresentation(payload);
    await self.registration.showNotification(view.title, {
      body: view.body,
      tag: view.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: payload,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const payload = parseNotificationPayload(event.notification.data);
    const relative = payload ? getNotificationPresentation(payload).url : "/";
    const target = new URL(relative, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (existing) {
      await existing.navigate(target);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
        }
      } catch {
        // Ignore malformed or opaque client URLs.
      }
    }
  })());
});
