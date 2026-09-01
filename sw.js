/* Sinoky service worker — network-first shell cache (kaikou pattern) */
var CACHE = 'sinoky-v0.3.4';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './data/flashcards.hsk1.json',
  './data/connect-templates.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  /* v0.1.1 fix (P2): cross-origin (TTS audio etc.) passes straight through —
     never cached, never polluting the shell cache */
  if (url.origin !== location.origin) return;
  /* version.json: network always, cache-busting query must not create cache entries */
  if (url.pathname.indexOf('version.json') > -1) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match('./version.json');
      })
    );
    return;
  }
  /* network-first: always try fresh, fall back to cached shell when offline */
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
