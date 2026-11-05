const CACHE = 'druzhba-shell-v3-theme';
const SHELL = ['/', '/style.css', '/dark.css', '/theme.js', '/app.js', '/manrope.ttf', '/icon-v2.svg', '/icon-192-v2.png', '/icon-512-v2.png', '/icon-maskable-v2.png', '/apple-touch-icon-v2.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname === '/' ? '/' : event.request).then(result => result || Response.error())));
});
