const CACHE_VERSION = 'v6';
const STATIC_CACHE = `droppr-static-${CACHE_VERSION}`;
const CORE_ASSETS = [
  '/static/gallery.min.css?v=2',
  '/static/gallery.min.js?v=3',
  '/static/video-player.min.css?v=1',
  '/static/hls.min.js?v=1',
  '/static/video-player.min.js?v=1',
  '/static/request.js?v=2',
  '/static/analytics.js?v=1',
  '/static/media-viewer.js?v=1',
  '/static/stream-gallery.js?v=3',
  '/static/test-media.js?v=1',
  '/static/sw-register.js?v=1',
  '/droppr-theme.css?v=10',
  '/droppr-panel.js?v=32'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith('/static/') ||
    url.pathname === '/droppr-theme.css' ||
    url.pathname === '/droppr-panel.js';

  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
