/* Ghost Post service worker: offline shell + static asset caching. API calls always go to the network. */
const CACHE = "np-shell-v2";
const SHELL = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build assets never change: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  // Pages: network first, offline page when there's no connection.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});

/* "It's ready" notifications from the server, shown even when Ghost Post is closed. */
self.addEventListener("push", (e) => {
  let msg = { title: "Ghost Post", body: "Something finished.", url: "/" };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    /* plain text or empty */
  }
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: msg.url }, tag: msg.url }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
