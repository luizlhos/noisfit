/* NoisFit — service worker: funciona offline (casca do app) e recebe notificações push. */
const CACHE = 'noisfit-v1.0.0';
const ASSETS = ['./', './index.html', './app.js', './api.js', './supabase.min.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = (await c.match(req, { ignoreSearch: true })) || (nav ? await c.match('./index.html') : null);
    const rede = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) {
      // Rede primeiro (até 3 s) para pegar atualizações; sem rede, usa o cache.
      return Promise.race([rede, new Promise((_, rej) => setTimeout(rej, 3000))]).catch(() => hit);
    }
    return rede;
  }));
});

// ------------------------------------------------------------------ push
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corpo: e.data && e.data.text() }; }
  const titulo = d.titulo || 'NoisFit';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope);
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertas) {
      if (new URL(c.url).pathname === alvo.pathname) {
        await c.focus();
        c.postMessage({ ir: alvo.hash.slice(1) || 'hoje' });
        return;
      }
    }
    await self.clients.openWindow(alvo.href);
  })());
});
