// Service worker: lets the site open offline and install as an app.
// Network first (always fresh when online), cached copy when offline.
// League data itself is cached by Firestore's own offline cache, not here.

const CACHE = 'jvo-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/config.js',
  '/js/firebase.js',
  '/js/data.js',
  '/js/ui.js',
  '/js/pages/parts.js',
  '/js/pages/home.js',
  '/js/pages/table.js',
  '/js/pages/fixtures.js',
  '/js/pages/match.js',
  '/js/pages/teams.js',
  '/js/pages/team.js',
  '/js/pages/player.js',
  '/js/rules/defaults.js',
  '/js/rules/match.js',
  '/js/rules/standings.js',
  '/js/rules/stats.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // leave Firebase/fonts alone

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('/index.html'); // any page -> app shell
        return Response.error();
      })
  );
});
