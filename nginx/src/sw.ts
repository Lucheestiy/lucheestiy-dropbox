/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v7";
const STATIC_CACHE = `droppr-static-${CACHE_VERSION}`;
const CORE_ASSETS: string[] = [
  "/static/gallery.min.css?v=2",
  "/static/gallery.min.js?v=3",
  "/static/video-player.min.css?v=1",
  "/static/hls.min.js?v=1",
  "/static/video-player.min.js?v=1",
  "/static/request.js?v=2",
  "/static/analytics.js?v=1",
  "/static/media-viewer.js?v=1",
  "/static/stream-gallery.js?v=3",
  "/static/test-media.js?v=1",
  "/static/sw-register.js?v=1",
  "/static/favicon.svg",
  "/static/manifest.json",
  "/droppr-theme.css?v=10",
  "/droppr-panel.js?v=32",
  "/gallery.html",
  "/stream-gallery.html",
  "/video-player.html",
  "/request.html",
];

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache: Cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys: string[]) =>
        Promise.all(
          keys
            .filter((key: string) => key !== STATIC_CACHE)
            .map((key: string) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigation requests (HTML pages)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res: Response) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache: Cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => {
          // Fallback to cached HTML based on path
          const path = url.pathname;
          let fallback = "/gallery.html";
          if (path.startsWith("/stream/")) fallback = "/stream-gallery.html";
          else if (path.startsWith("/request/")) fallback = "/request.html";
          else if (path === "/player") fallback = "/video-player.html";

          return caches.match(fallback).then((cached) => {
            return cached || new Response("Offline - Page not found", { status: 503 });
          });
        })
    );
    return;
  }

  const isStatic =
    url.pathname.startsWith("/static/") ||
    url.pathname === "/droppr-theme.css" ||
    url.pathname === "/droppr-panel.js" ||
    CORE_ASSETS.includes(url.pathname);

  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then((cached: Response | undefined) => {
      if (cached) return cached;
      return fetch(req)
        .then((res: Response) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache: Cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached ?? new Response("Not found", { status: 404 }));
    })
  );
});

export {};
