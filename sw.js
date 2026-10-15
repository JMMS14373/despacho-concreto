/* Service worker: guarda la app en el celular para usarla sin señal.
   Caché con nombre propio y alcance limitado a esta carpeta: no interfiere con otras apps del mismo dominio. */
const CACHE = 'despacho-concreto-v2';
const ARCHIVOS = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './app/styles.css', './app/app.js', './app/maestro.js', './app/qr.js',
  './app/vendor/xlsx.full.min.js', './app/vendor/jsQR.js', './ejemplo/maestro_ejemplo.xlsx',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('despacho-concreto-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir actualizaciones con señal); si no hay señal, usa la copia guardada.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
