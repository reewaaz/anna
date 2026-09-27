// Bump when the app shell changes, so returning visitors pick up new JS.
const CACHE = 'anna-v9';
// NOTE: ./version.json is deliberately NOT in ASSETS. It is the source of truth
// for "is the running build stale?", so precaching it would freeze the answer.
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/search.js',
  './js/parser.js',
  './js/viewer.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache cross-origin proxy/Anna requests; always go to network.
  // Search results are per-query and change constantly, and a cached 403 from
  // Anna's bot protection would otherwise stick around long after it lifted.
  if (url.origin !== self.location.origin) return;

  // Network-first for the app shell. This was cache-first, which meant a fix
  // only reached anyone who remembered to bump CACHE by hand -- a broken
  // build kept serving itself indefinitely and looked like the deploy had not
  // landed. Now a new deploy is picked up on the next load, and the cache is
  // only a fallback for offline use.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
