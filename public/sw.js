// Skitta service worker: alleen voor pushmeldingen (geen offline-cache, zodat de app altijd vers is).
// De inhoud van berichten zit niet in de melding: die is end-to-end versleuteld.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch {}
  const title = data.title || 'Skitta';
  const options = {
    body: data.body || 'Nieuw bericht',
    icon: '/img/icon-192.png',
    badge: '/img/badge.png',
    tag: data.tag || 'skitta',
    renotify: true,
    data: { c: data.c || 0, t: data.t || 'msg' },
    requireInteraction: data.t === 'call',
    vibrate: data.t === 'call' ? [400, 200, 400, 200, 400] : [120]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const c = e.notification.data?.c;
  const url = c ? `/#c${c}` : '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ t: 'open', c });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
