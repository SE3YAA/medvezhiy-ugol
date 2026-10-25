// sw.js — офлайн-режим: приложение открывается в лесу даже без связи.
// При изменении файлов увеличьте номер версии, чтобы телефоны подтянули обновление.
const VERSION = 'mu-v19';
const FILES = ['./', 'index.html', 'style.css', 'config.js', 'catalog.js', 'db.js', 'sync.js', 'app.js', 'admin.js', 'staff.js', 'guest.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сначала сеть, при её отсутствии — сохранённая копия
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // запросы к серверу базы не кешируем
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// Уведомление с сервера (Web Push). Его обязательно нужно показать: iOS отзывает подписку у приложений, которые молчат
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Медвежий угол', {
    body: d.body || 'Новое уведомление', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, data: { url: d.url || './' }
  }));
});
// Нажали на уведомление: открываем приложение на нужном экране
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const win = list.find(c => c.url.indexOf(self.registration.scope) === 0);
    if (win) { win.postMessage({ type: 'open', url }); return win.focus(); }
    return self.clients.openWindow(url);
  }));
});
