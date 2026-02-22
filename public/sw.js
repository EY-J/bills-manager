const CACHE_VERSION = "bills-tracker-v2";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/vite.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Keep non-http schemes untouched.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // App navigation: network first, fallback to cached app shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/index.html");
        })
    );
    return;
  }

  // Same-origin assets: cache first, then network.
  // Never fallback to index.html for JS/CSS/media requests.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            // Cache only successful basic responses.
            if (!response || response.status !== 200 || response.type !== "basic") {
              return response;
            }
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            return response;
          });
      })
    );
  }
});
