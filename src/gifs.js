// GIF's zoeken via GIPHY. Alles loopt via ons: GIPHY ziet zo niet wie er zoekt of kijkt (geen IP-adressen
// van gebruikers), en zoekresultaten worden een uur bewaard in de cache van Cloudflare zodat we ver onder
// de limiet van de gratis GIPHY-sleutel blijven. (Tenor bestaat sinds juni 2026 niet meer voor apps.)

import { json, fail } from './util.js';

const API = 'https://api.giphy.com/v1/gifs';
const MEDIA_HOST = /^(media\d*|i)\.giphy\.com$/;
const MAX_SEND = 1024 * 1024;

function pick(g) {
  const im = g.images || {};
  const small = im.fixed_width_small || im.fixed_width || {};
  const preview = im.fixed_width_small?.webp || im.fixed_width?.webp || small.url;
  // Versturen: het origineel als dat klein genoeg is, anders de versie van 200 pixels breed.
  const orig = im.original || {};
  const send = orig.mp4 && Number(orig.mp4_size) <= MAX_SEND ? orig : im.fixed_width || orig;
  if (!preview || !send.mp4) return null;
  return {
    id: g.id,
    title: g.title || '',
    w: Number(small.width) || 100,
    h: Number(small.height) || 100,
    preview: proxied(preview),
    mp4: proxied(send.mp4),
    sw: Number(send.width) || 200,
    sh: Number(send.height) || 200
  };
}

function proxied(u) {
  return `/api/gif/media?u=${encodeURIComponent(u.split('?')[0])}`;
}

export async function gifSearch(env, url, ctx) {
  if (!env.GIPHY_KEY) return fail(503, 'GIF\'s zijn nog niet ingesteld');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 50).toLowerCase();
  const offset = Math.min(200, Math.max(0, Number(url.searchParams.get('offset')) || 0));
  const target = q
    ? `${API}/search?q=${encodeURIComponent(q)}&limit=24&offset=${offset}&rating=pg-13&lang=nl&bundle=messaging_non_clips`
    : `${API}/trending?limit=24&offset=${offset}&rating=pg-13&bundle=messaging_non_clips`;
  // Cachen zonder de sleutel in de cachesleutel.
  const cacheKey = new Request(`https://gif-cache.skitta/${q ? 's' : 't'}/${encodeURIComponent(q)}/${offset}`);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (!res) {
    const up = await fetch(`${target}&api_key=${env.GIPHY_KEY}`);
    if (!up.ok) return fail(502, up.status === 429 ? 'Even te veel GIF-zoekopdrachten; probeer het zo nog eens' : 'GIPHY is nu niet bereikbaar');
    const data = await up.json();
    const out = { gifs: (data.data || []).map(pick).filter(Boolean), next: (data.pagination?.offset || 0) + (data.data?.length || 0) };
    res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${q ? 3600 : 1800}` } });
    ctx?.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return json(await res.json());
}

export async function gifMedia(url) {
  let target;
  try {
    target = new URL(url.searchParams.get('u') || '');
  } catch {
    return fail(400, 'Ongeldig adres');
  }
  if (target.protocol !== 'https:' || !MEDIA_HOST.test(target.hostname)) return fail(400, 'Ongeldig adres');
  const up = await fetch(target.toString(), { cf: { cacheEverything: true, cacheTtl: 86400 } });
  if (!up.ok) return fail(404, 'Niet gevonden');
  const type = up.headers.get('content-type') || '';
  if (!/^(image|video)\//.test(type)) return fail(400, 'Ongeldig bestand');
  return new Response(up.body, {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }
  });
}
