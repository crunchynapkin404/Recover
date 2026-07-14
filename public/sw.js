// Minimal on purpose: push + notification click + offline fallback.
// No precaching — the app is data-driven and needs the network anyway.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Recover", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Recover", {
      body: payload.body || "",
      tag: payload.tag || "recover",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><title>Offline</title><body style="background:#0a0a0a;color:#fff;font-family:system-ui;display:grid;place-items:center;height:100vh"><div><h1>Offline</h1><p>Recover needs a connection.</p></div>',
          { headers: { "Content-Type": "text/html" } }
        )
    )
  );
});
