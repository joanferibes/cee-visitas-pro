// CEE Visitas Pro · Service Worker v1
const CACHE_NAME = "cee-visitas-pro-v1";
const URLS = [
  "./",
  "./index.html",
  "./app.js?v=1",
  "./croquis.js?v=1",
  "./config.js?v=1",
  "./style.css?v=1",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cee-visitas-pro-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para la app (para recibir las actualizaciones), caché si no hay cobertura
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.indexOf("script.google.com") > -1 || req.url.indexOf("googleusercontent.com") > -1) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
