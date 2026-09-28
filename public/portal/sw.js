/* Service worker for the MALTO team portal.
 *
 * Scope is /portal/ because the file lives in public/portal/, so it never
 * takes over the public website.
 *
 * It does three things:
 *   - show a notification when a job arrives, and make tapping it land on the
 *     portal. The payload carries the URL the server chose rather than assuming
 *     one, so a future notification type can point somewhere else.
 *   - keep the app shell available offline, so a partner standing in a building
 *     with no signal still gets the portal rather than a blank white screen.
 *   - the offline strategy, which is cache-first for hashed build assets and
 *     network-first for pages.
 *
 * What is deliberately NOT cached: anything from Supabase. The job list comes
 * from the database and caching an API response means a partner can be looking
 * at yesterday's assignments with no way to tell. Data is cached in IndexedDB by
 * lib/portal-cache.ts, which is keyed by user and shows its own age.
 */

const VERSION = "malto-portal-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;

/** The pages that make up the app. Small, fixed, and known at build time. */
const SHELL = [
  "/portal",
  "/portal/login",
  "/portal/register",
  "/portal/profile",
  "/portal/hours",
  "/portal/sw.js",
];

/** Request prefixes we must never serve from a cache. */
function isApiLike(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/image") ||
    // Supabase data, auth and storage. Stale here is worse than nothing.
    url.hostname.includes("supabase.co")
  );
}

self.addEventListener("install", (event) => {
  // Take over as soon as it is installed, so the member is not left with a
  // stale worker after the first enable.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {
        // One unreachable page must not fail the whole install and leave the
        // partner with no offline shell and no notifications.
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an earlier version. A new release changes the hashed
      // asset names, so keeping the old ones would let a stale build run.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApiLike(url)) return;

  // Hashed build assets. The filename changes when the content changes, so a
  // cache hit can never be wrong, and a miss is free to go to the network.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        // Network first. A partner who has just been given a job should see it,
        // and the cost of being slightly slower is far lower than the cost of
        // showing a job list that is hours old and not saying so.
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match(req, { cacheName: PAGE_CACHE });
          if (cached) return cached;
          const shell = await caches.match(url.pathname, { cacheName: SHELL_CACHE });
          if (shell) return shell;
          return new Response(
            `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
             <title>MALTO Partner</title>
             <body style="font:16px system-ui;padding:2rem;text-align:center">
             <h1>No connection</h1>
             <p>Open the app once while you have a signal, then it will work offline.</p>`,
            { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 }
          );
        }
      })()
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MALTO", body: event.data ? event.data.text() : "You have an update." };
  }

  const title = data.title || "MALTO";
  const options = {
    body: data.body || "",
    // Collapses repeat notifications for the same job on the lock screen.
    tag: data.tag || "malto-assignment",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { url: data.url || "/portal" },
    // iOS requires a service worker notification to be user visible.
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Reuse an open portal window rather than piling up new ones. The fence
      // rules it to /portal, and checkValidity rejects a cross-origin match, so
      // only our own window is ever focused.
      for (const client of clientList) {
        if (client.url.includes("/portal") && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
