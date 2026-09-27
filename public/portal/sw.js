/* Service worker for the MALTO team portal.
 *
 * Scope is /portal/ because the file lives in public/portal/, so it never
 * takes over the public website.
 *
 * It does two things: show a notification when a job arrives, and make tapping
 * it land on the portal. The payload carries the URL the server chose rather
 * than assuming one, so a future notification type can point somewhere else.
 */

self.addEventListener("install", (event) => {
  // Take over as soon as it is installed, so the member is not left with a
  // stale worker after the first enable.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
      // Reuse an open portal tab rather than piling up new ones.
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
