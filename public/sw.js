// Certimar RV — Service Worker
// Estrategia: Network-First para el HTML (index.html / navegación) para que cada deploy
// se vea de inmediato; Stale-While-Revalidate para assets estáticos; pass-through API/Firebase
const CACHE_NAME    = 'certimar-rv-v9';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/gmailAuth.js', '/metricsLog.js', '/pdfMail.js', '/firma.html', '/firmaPage.js', '/concesiones.js', '/aquachile.js'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Network First: Firebase APIs, Functions, Auth
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('accounts.google.com') ||
    url.pathname.startsWith('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }

  // Network-First para el HTML (navegación, / e /index.html): siempre la última
  // versión cuando hay internet; la caché solo es respaldo si la red falla (offline).
  var isHTML = event.request.mode === 'navigate' ||
               url.pathname === '/' ||
               url.pathname === '/index.html';

  if (isHTML) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate: para assets estáticos responde con caché y actualiza en background
  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(response) {
          if (response.status === 200 && url.origin === self.location.origin) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(function() { return cached; });
        return cached || fetchPromise;
      });
    })
  );
});
