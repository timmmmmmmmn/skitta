// Skitta service worker: pushmeldingen en het streamen van versleutelde video's.
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

// ---------- Video's streamen ----------
// Grote bestanden staan versleuteld in stukken van 4 MB (elk: iv 12 bytes + inhoud + tag 16 bytes).
// De pagina meldt een video aan (id, sleutel, grootte); <video src="/stream/<id>"> vraagt dan stukjes
// (Range) en wij halen alleen de nodige stukken op, ontsleutelen ze en geven precies dat stukje terug.
// Zo begint een video meteen en kun je doorspoelen, zonder eerst alles te downloaden.

const CHUNK = 4 * 1024 * 1024;
const ENC = CHUNK + 28;
const streams = new Map();

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.t === 'stream') streams.set(d.id, { file: d.file, key: d.key, size: d.size, mime: d.mime || 'video/mp4', cache: new Map(), ticket: null });
});

const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function ticket(s) {
  if (s.ticket && s.ticket.until > Date.now()) return s.ticket;
  const res = await fetch(`/api/big/${encodeURIComponent(s.file)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('geen toegang');
  const t = await res.json();
  s.ticket = { url: t.url, token: t.token, until: Date.now() + 5 * 3600e3, enc: t.size };
  return s.ticket;
}

async function chunk(s, i) {
  if (s.cache.has(i)) return s.cache.get(i);
  const p = (async () => {
    const t = await ticket(s);
    const from = i * ENC;
    const to = Math.min(from + ENC, t.enc) - 1;
    const res = await fetch(t.url, { headers: { authorization: `Bearer ${t.token}`, range: `bytes=${from}-${to}` } });
    if (!res.ok) throw new Error('stuk niet gevonden');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!s.cryptoKey) s.cryptoKey = await crypto.subtle.importKey('raw', unb64(s.key), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, s.cryptoKey, bytes.subarray(12)));
  })();
  s.cache.set(i, p);
  p.catch(() => s.cache.delete(i));
  // Een paar stukken bewaren (vooruit en terug), de rest weggooien.
  if (s.cache.size > 4) s.cache.delete(s.cache.keys().next().value);
  return p;
}

async function stream(req, id) {
  const s = streams.get(id);
  if (!s) return new Response('Onbekende video', { status: 404 });
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  const start = m ? Number(m[1]) : 0;
  // Per verzoek hooguit één stuk teruggeven; de speler vraagt zelf om het volgende.
  const firstChunk = Math.floor(start / CHUNK);
  const chunkEnd = Math.min((firstChunk + 1) * CHUNK, s.size) - 1;
  const end = Math.min(m && m[2] ? Number(m[2]) : chunkEnd, chunkEnd, s.size - 1);
  if (start >= s.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${s.size}` } });
  const plain = await chunk(s, firstChunk);
  // Het volgende stuk alvast ophalen, zodat het afspelen niet hapert.
  if ((firstChunk + 1) * CHUNK < s.size) chunk(s, firstChunk + 1).catch(() => {});
  const body = plain.subarray(start - firstChunk * CHUNK, end - firstChunk * CHUNK + 1);
  return new Response(body, {
    status: 206,
    headers: {
      'content-type': s.mime, 'content-length': String(body.length), 'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${s.size}`, 'cache-control': 'no-store'
    }
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/stream/')) {
    e.respondWith(stream(e.request, decodeURIComponent(url.pathname.slice(8))).catch(() => new Response('Fout', { status: 500 })));
  }
});
