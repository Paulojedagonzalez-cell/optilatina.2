// El sufijo __BUILD_ID__ lo reemplaza scripts/stamp-sw.mjs en cada build, así
// cada despliegue genera un service worker distinto y el navegador lo detecta
// como versión nueva. Al activarse BORRA TODO el caché anterior — nunca se
// queda pegado en una versión vieja.
const CACHE = "optilatina-__BUILD_ID__";

self.addEventListener("install", e => {
  // Toma el control de inmediato, sin esperar a que se cierren las pestañas.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // Nuke total: borrar TODOS los cachés (viejos y actuales) para arrancar limpio.
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // Recrear el shell mínimo para respaldo offline.
    try { const c = await caches.open(CACHE); await c.addAll(["/", "/index.html"]); } catch {}
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (url.includes("firebase") || url.includes("googleapis") || url.includes("dolarapi")) return;

  // Network-first para navegación/HTML: siempre la versión más reciente,
  // con caché solo como respaldo cuando no hay internet.
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

  // Assets con hash (index-XXXX.js) son inmutables: cache-first para velocidad.
  // Como cada despliegue cambia el hash, nunca se sirve JS viejo por error.
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

// Permite que la app pida saltar la espera (botón "Actualizar").
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
