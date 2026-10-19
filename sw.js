const V = 'kt-trip-v5';
const CORE = ['./', './index.html', './support.js', './manifest.webmanifest', './assets/stickers/barn.png', './assets/stickers/camera.png', './assets/stickers/chedi.png', './assets/stickers/curry.png', './assets/stickers/jeep.png', './assets/stickers/karst.png', './assets/stickers/moon.png', './assets/stickers/pizza.png', './assets/photos/aleenta.jpg', './assets/photos/conrad.jpg', './assets/photos/kona-rio.jpg', './assets/photos/kona.jpg', './assets/photos/kyle-tj-wrigley.jpg', './assets/photos/rio.jpg', './assets/photos/tj-kyle-beach.jpg', './assets/photos/waldorf.jpg', './assets/photos/yorkville-cartoon.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/ntfy\.sh|open-meteo|nominatim|api\.github\.com/.test(u.host)) return; // always live
  const isPage = e.request.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('.js');
  if (isPage) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })));
  }
});
