// Certimar RV — Service Worker
// Estrategia: Cache First para assets estáticos, Network First para API/Firebase
const CACHE_NAME    = 'certimar-rv-v1';
const CACHE_ASSETS  = ['/', '/index.html', '/firebaseConfig.js', '/concesiones.js'];

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

  // Cache First para assets estáticos
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Solo cachear respuestas válidas de mismo origen
        if (
          response.status === 200 &&
          url.origin === self.location.origin
        ) {
          var cloned = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, cloned);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback para navegación
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
