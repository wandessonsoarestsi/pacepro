/* PacePro: funciona sem internet. Arquivos do site em cache; o Strava sempre pela rede. */
const CACHE = 'pacepro-v60';
const CORE = ['/', '/styles.css', '/app.js', '/plan-parser.js', '/analysis.js', '/route-map.js', '/route-video.js', '/route-image.js', '/plan-generator.js', '/plano.md', '/strava/connect-with-strava.svg', '/strava/powered-by-strava.svg',
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

/* Notificações: o servidor manda { title, body, url, tag }. Cada uma também fica guardada na caixa do app
   (IndexedDB, só neste aparelho), que aparece no sininho do topo. */
function inboxDb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('pacepro', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('inbox')) r.result.createObjectStore('inbox', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function inboxAdd(m, id) {
  try {
    const db = await inboxDb();
    await new Promise((ok, no) => {
      const tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').put({ id, title: m.title || 'PacePro', body: m.body || '', url: m.url || '/', tag: m.tag || '', at: Date.now(), read: false });
      tx.oncomplete = ok; tx.onerror = () => no(tx.error);
    });
    db.close();
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: 'inbox' }));
  } catch (e) {}
}
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // Primeiro mostra a notificação (o iPhone cancela a inscrição se um push não mostrar nada), depois guarda na caixa.
  const opts = { body: m.body || '', icon: '/icon-192.png', data: { url: m.url || '/', id } };
  if (m.tag) opts.tag = m.tag;
  e.waitUntil(self.registration.showNotification(m.title || 'PacePro', opts)
    .catch(() => self.registration.showNotification(m.title || 'PacePro', { body: m.body || '' }))
    .then(() => inboxAdd(m, id)).catch(() => {}));
});
// Tocar na notificação marca como lida na caixa do app.
async function inboxRead(id) {
  if (!id) return;
  try {
    const db = await inboxDb();
    await new Promise(ok => {
      const tx = db.transaction('inbox', 'readwrite'), st = tx.objectStore('inbox'), g = st.get(id);
      g.onsuccess = () => { if (g.result) st.put({ ...g.result, read: true }); };
      tx.oncomplete = ok; tx.onerror = ok;
    });
    db.close();
  } catch (e) {}
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const read = inboxRead(e.notification.data && e.notification.data.id);
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(read.then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true })).then(list => {
    const w = list.find(c => new URL(c.url).origin === self.location.origin);
    if (w) return w.focus().then(c => (c && 'navigate' in c ? c.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
