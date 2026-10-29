// Service worker de PokéCasino.
// - Archivos de la app: primero la red (siempre la última versión) y, sin conexión, la copia guardada.
// - Sprites de PokeAPI: primero la caché (no cambian) para cargar mucho más rápido.
// - GIF animados de Showdown (play.pokemonshowdown.com): no se guardan aquí (respuestas opacas, pesan más); los cachea el navegador.
// - Nunca se guarda nada de /api, del socket ni de changelog.json (las novedades siempre frescas).
const VERSION = 'v17';
const APP = 'pokecasino-app-' + VERSION;
const SPRITES = 'pokecasino-sprites';
const SPRITE_LIMIT = 1500;
const SHELL = ['/', '/index.html', '/css/style.css', '/css/fx.css', '/css/mega.css', '/css/quiz.css', '/css/news.css', '/css/pc.css', '/css/bond.css', '/css/afk.css', '/css/anim.css', '/css/battle.css', '/js/main.js', '/js/core.js', '/js/pkicons.js', '/js/theme.js', '/js/nav.js', '/fonts/jersey-10-latin-400-normal.woff2', '/fonts/nunito-latin-wght-normal.woff2', '/offline.html', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('pokecasino-app-') && k !== APP).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimSprites() {
  const c = await caches.open(SPRITES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - SPRITE_LIMIT; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && (url.pathname === '/changelog.json' || url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io') || url.pathname === '/healthz')) return;

  if (url.hostname === 'raw.githubusercontent.com') {
    e.respondWith(caches.open(SPRITES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimSprites(); }
      return res;
    }).catch(() => fetch(req)));
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())));
});

// Al tocar una notificación se abre (o enfoca) el casino en la pantalla indicada.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.location.origin));
    if (w) { if (link) w.postMessage({ type: 'goto', link }); return w.focus(); }
    return self.clients.openWindow('/' + link);
  }));
});
