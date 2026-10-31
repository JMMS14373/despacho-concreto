/* Service worker: guarda la app en el celular para usarla sin señal.
   - Con señal: siempre pide la versión más reciente al servidor (sin copias viejas).
   - Sin señal: usa la última versión guardada.
   Caché con nombre propio y alcance limitado a esta carpeta: no interfiere con otras apps del mismo dominio.
   No hay que cambiar nada aquí al publicar una actualización: basta con subir los archivos. */
const CACHE = 'despacho-concreto';
const ARCHIVOS = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './app/styles.css', './app/app.js', './app/maestro.js', './app/pin.js', './app/cierre.js', './app/qr.js',
  './app/vendor/xlsx.full.min.js', './app/vendor/jsQR.js', './app/vendor/qrcode.js', './ejemplo/maestro_ejemplo.xlsx',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('despacho-concreto') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
