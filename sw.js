// Service worker «Задач»: показывает пуш-уведомления и открывает приложение по нажатию.
// Страницы не кеширует — сайт всегда загружается свежим.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Задачи', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || undefined,          // уведомления об одной задаче заменяют друг друга
    renotify: !!d.tag,
    data: { url: d.url || './', note: d.note || null },
    lang: 'ru',
  }));
});

// Нажатие: открытое окно приложения — в фокус и показать уведомления; иначе — открыть приложение.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url, note } = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (win) { await win.focus(); win.postMessage({ type: 'open-notes', note }); return; }
    await self.clients.openWindow(url || './');
  })());
});
