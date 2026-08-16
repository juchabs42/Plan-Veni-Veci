const CACHE = 'veni-vici-v1';
const SUPABASE_MODULE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './config.js', './manifest.json',
  './training-plan.json', './icons/icon-192.png', './icons/icon-512.png', SUPABASE_MODULE
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && request.url !== SUPABASE_MODULE) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
