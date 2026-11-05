/* VYRON service worker.
   - Cache names start with "vyron-"; only OBSOLETE vyron-* caches are ever deleted, so other apps
     hosted on the same github.io origin keep their own caches.
   - Bump VERSION whenever a precached file changes. */
const VERSION = '2.0.0';
const PREFIX = 'vyron-';
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' bypasses the browser HTTP cache so a new version is never assembled from stale files
    await Promise.all(ASSETS.map(async url => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + url + ' ' + res.status);
      await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // never touch other origins / non-GET

  // Page loads: try the network first so updates arrive, fall back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put('index.html', copy))); }
        return res;
      } catch (_) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: cache first (they were precached together, so versions stay consistent), network as fallback.
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(req, copy))); }
      return res;
    } catch (_) {
      return Response.error(); // a failed request stays a failed request (no HTML masquerading as an image or script)
    }
  })());
});
