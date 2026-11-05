/* PacePro: funciona sem internet. Arquivos do site em cache; o Strava sempre pela rede. */
const CACHE = 'pacepro-v5';
const CORE = ['/', '/styles.css', '/app.js', '/plan-parser.js', '/analysis.js', '/plan-generator.js', '/plano.md',
  '/icon.svg', '/icon-192.png', '/apple-touch-icon.png', '/manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'skip') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // Strava: sempre pela rede
  // Rede primeiro (para receber atualizações), cache quando estiver sem internet.
  e.respondWith(fetch(req).then(res => {
    if (res.ok && (url.origin === location.origin || /jsdelivr|fonts\.(googleapis|gstatic)/.test(url.host))) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
