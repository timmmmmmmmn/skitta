// Skitta Lite service worker: alleen pushmeldingen (berichten en oproepen). Geen cache: de app is klein
// en moet altijd de nieuwste versie laden. Op skittalite.timvanbergen.nl is de scope "/", op skitta "/lite/".

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch {}
  const call = data.t === 'call';
  const scope = self.registration.scope;
  e.waitUntil(self.registration.showNotification(data.title || 'Skitta Lite', {
    body: data.body || 'Nieuw bericht',
    icon: `${scope}img/icon-192.png`,
    tag: data.tag || 'skittalite',
    renotify: true,
    data: { c: data.c || 0, t: data.t || 'msg' },
    requireInteraction: call,
    vibrate: call ? [400, 200, 400, 200, 400] : [120]
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { c, t } = e.notification.data || {};
  const scope = self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.startsWith(scope)) {
        await client.focus();
        client.postMessage({ t: 'open', c, call: t === 'call' });
        return;
      }
    }
    await self.clients.openWindow(c ? `${scope}#c${c}` : scope);
  })());
});
