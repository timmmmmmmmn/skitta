// Grote bijlagen via een eigen bestandsserver (server/ in deze repo, bijv. op een Arch Linux-server).
// Aan zodra FILES_URL en het geheim FILES_SECRET zijn ingesteld. De Worker geeft kortlopende,
// ondertekende toegangsbewijzen (HMAC-SHA256); de bestandsserver controleert die met hetzelfde geheim.
// Wat er wordt opgeslagen is al end-to-end versleuteld, dus de server kan de inhoud niet zien.

import { HttpError, randomToken } from './util.js';

export const BIG = {
  min: 8 * 1024 * 1024, // kleiner gaat naar R2
  max: 1024 * 1024 * 1024, // 1 GB
  bigAfter: 50 * 1024 * 1024, // vanaf deze grootte korter bewaren
  shortDays: 7,
  longDays: 90,
  userDaily: 2 * 1024 * 1024 * 1024
};

export const enabled = (env) => !!(env.FILES_URL && env.FILES_SECRET);

async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.FILES_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Token: "<handeling>.<id>.<grootte>.<verloopt>.<handtekening>"
async function token(env, action, id, size, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${action}.${id}.${size}.${exp}`;
  return `${body}.${await sign(env, body)}`;
}

export async function uploadTicket(env, user, conv, size, usedToday) {
  if (!enabled(env)) throw new HttpError(503, 'Grote bestanden versturen staat nog niet aan');
  if (!Number.isFinite(size) || size < 1) throw new HttpError(400, 'Ongeldige grootte');
  if (size > BIG.max) throw new HttpError(413, 'Bestanden mogen maximaal 1 GB zijn');
  if (usedToday + size > BIG.userDaily) throw new HttpError(429, 'Je hebt vandaag al veel grote bestanden verstuurd');
  const id = randomToken(18);
  const days = size >= BIG.bigAfter ? BIG.shortDays : BIG.longDays;
  const t = Date.now();
  await env.DB.prepare('INSERT INTO bigfiles (id, conversation_id, owner_id, size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, conv.id, user.id, size, t, t + days * 86400e3).run();
  return { id, url: `${env.FILES_URL.replace(/\/$/, '')}/f/${id}`, token: await token(env, 'put', id, size, 3600), expires_at: t + days * 86400e3 };
}

export async function downloadTicket(env, user, id) {
  if (!enabled(env)) throw new HttpError(503, 'De bestandsserver is niet ingesteld');
  const row = await env.DB.prepare(
    `SELECT b.* FROM bigfiles b JOIN members m ON m.conversation_id = b.conversation_id AND m.user_id = ? WHERE b.id = ?`
  ).bind(user.id, id).first();
  if (!row) throw new HttpError(404, 'Bestand niet gevonden');
  if (row.expires_at < Date.now()) throw new HttpError(410, 'Dit bestand is verlopen en verwijderd');
  return { url: `${env.FILES_URL.replace(/\/$/, '')}/f/${id}`, token: await token(env, 'get', id, row.size, 600), size: row.size };
}
