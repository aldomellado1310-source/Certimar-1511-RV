// Certimar RV — Service Worker
// Estrategia: Stale-While-Revalidate para assets estáticos, pass-through para API/Firebase
const CACHE_NAME    = 'certimar-rv-v4';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/concesiones.js', '/aquachile.js'];

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
    url.pathname.startsWith('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }

  // Stale-While-Revalidate: responde con caché inmediatamente y actualiza en background
  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(response) {
          if (response.status === 200 && url.origin === self.location.origin) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(function() {
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
        return cached || fetchPromise;
      });
    })
  );
});
