const CACHE = "optilatina-v5";

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(["/", "/index.html"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (url.includes("firebase") || url.includes("googleapis")) return;

  // Network-first para navegación/HTML: siempre servir la versión más reciente,
  // con caché solo como respaldo offline.
  if (e.request.mode === "navigate" || url.endsWith("/index.html")) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match("/index.html")))
    );
    return;
  }

  // Cache-first para assets con hash (inmutables), guardándolos al vuelo.
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
    )
  );
});
