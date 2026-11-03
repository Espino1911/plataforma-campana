// Plataforma de Campaña: la app abre sin señal. Los datos viven en el servidor y no se guardan aquí.
const VERSION = '0.2.1';
const CACHE = 'plataforma-' + VERSION;
const ASSETS = ['./', 'index.html', 'analisis.html', 'data/catalogo.json', 'data/resultados.json', 'data/ln2026.json', 'app.js', 'config.js', 'manifest.webmanifest',
  'vendor/supabase.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/topojson-client.min.js', 'vendor/qrcode.js',
  'data/geo.json', 'data/nombres.json',
  'fonts/plex-cond-400.woff2', 'fonts/plex-cond-500.woff2', 'fonts/plex-cond-600.woff2', 'fonts/plex-cond-700.woff2', 'fonts/plex-mono-400.woff2', 'fonts/plex-mono-500.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/favicon-48.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('plataforma-') && x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // la base de datos nunca pasa por la caché
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => hit || fetch(e.request)));
});
