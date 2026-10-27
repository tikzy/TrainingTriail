/* Service worker TrainingTrail — page : réseau d'abord (mises à jour
   immédiates) puis cache hors ligne ; fichiers versionnés : cache-first.
   À chaque déploiement : mettre à jour CACHE et les versions ?v= ci-dessous. */
const CACHE = "trainingtrail-2026102806";
const ASSETS = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./css/style.css?v=2026102805",
  "./js/data.js?v=2026102805",
  "./js/anim.js?v=2026102805",
  "./js/gpx.js?v=2026102805",
  "./js/app.js?v=2026102805"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;               // PUT/DELETE : réseau
  if (url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("api/") === 0)
    return e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ ok: false, offline: true }), { headers: { "Content-Type": "application/json" } })));

  /* page principale : réseau d'abord, cache en secours (démarrage hors ligne) */
  if (e.request.mode === "navigate" || url.pathname === "/" || /index\.html$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(h => h || caches.match("./")))
    );
    return;
  }
  /* fichiers versionnés (?v=) : cache-first ; sinon réseau avec mise en cache */
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
