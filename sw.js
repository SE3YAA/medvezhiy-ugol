// sw.js — офлайн-режим: приложение открывается в лесу даже без связи.
// При изменении файлов увеличьте номер версии, чтобы телефоны подтянули обновление.
const VERSION = 'mu-v11';
const FILES = ['./', 'index.html', 'style.css', 'catalog.js', 'db.js', 'app.js', 'admin.js', 'staff.js', 'guest.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сначала сеть, при её отсутствии — сохранённая копия
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
