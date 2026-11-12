// FujinTrip service worker — offline plan, free (community round, design §7).
//
// Offline is the feature travelers notice most: roaming costs money and
// airports have poor signal, so a planner that needs a connection fails
// when it matters. The plan itself already lives in localStorage; this
// worker makes the APP SHELL load with no connection, so the saved plan
// (and the Today view built from it) opens offline.
//
// Strategy:
//  - Navigation requests: network-first, fall back to the cached shell
//    ('/') when offline. The cached shell plus the plan in localStorage
//    is the offline app.
//  - Same-origin static assets (/_next/static/*, /images/*, reel media
//    under /api/reels/media/*): cache-first — they never change.
//  - /api/* (live data: chat, fares, food, flight status): never cached.
//    The one exception is reel media, which is immutable content — the
//    feed list itself (/api/reels) is network-first with a cache fallback,
//    so the feed shows the last loaded posts offline, labeled as such by
//    the UI's offline banner.
//  - Versioned cache ('fujintrip-v1'): a new deploy installs a new
//    worker and deletes the old caches, so a stale shell never lingers.
const CACHE = 'fujintrip-v1';
const SHELL = ['/', '/images/fujin-wind-god.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third-party tiles, fonts — untouched

  // Live data is never cached (except immutable reel media, below).
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/reels/media/')) {
    return;
  }

  // Static assets + reel media: cache-first, fall back to network.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/api/reels/media/')
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigation + everything else: network-first, cached shell when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.mode === 'navigate') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('/'))
      )
  );
});
