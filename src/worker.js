// Skitta: JSON-API op /api/..., live verbinding op /api/ws (naar de Hub), de rest zijn de statische
// bestanden in public/ (de app op / en het beheer op /beheer).

import {
  HttpError, json, now, hashPassword, verifyPassword, createSession, destroySession,
  clearSessionCookie, sessionUser, tooManyAttempts, recordAttempt, clientIp, randomToken
} from './util.js';
import { Hub, effectivePresence } from './hub.js';
import { LIMITS, bump, usageKey, checkUpload, canRead, turnAllowed, usageReport } from './limits.js';
import { pushTo, vapidPublicKey } from './push.js';
import { BIG, uploadTicket, downloadTicket } from './bigfiles.js';
import { gifSearch, gifMedia } from './gifs.js';

export { Hub };

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PRESENCES = ['online', 'away', 'dnd', 'invisible'];
const REASONS = ['spam', 'intimidatie', 'ongepast', 'nep', 'anders'];
const MAX_TEXT = 8000;
const MAX_GROUP = 50;
const PAGE = 60;
const EDIT_WINDOW = 24 * 3600e3;

const hub = (env) => env.HUB.get(env.HUB.idFromName('hub'));

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ongeldige invoer');
  }
}

function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

async function setting(env, key, fallback = '') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

function publicUser(u, presence) {
  return {
    id: u.id, username: u.username, display_name: u.display_name, mood: u.mood || '',
    avatar: u.avatar_id || null, ...(presence !== undefined ? { presence } : {})
  };
}

// ---------- Sleutels (end-to-end) ----------
// De server ziet nooit het wachtwoord: de browser stuurt een afgeleide inlogcode (auth) en bewaart hier
// alleen het versleutelde geheime deel van het sleutelpaar. Alles is base64.

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function b64field(v, min, max, name) {
  const s = String(v ?? '');
  if (s.length < min || s.length > max || !B64_RE.test(s)) throw new HttpError(400, `Ongeldige ${name}; ververs de pagina en probeer het opnieuw`);
  return s;
}

// De sleutelgegevens die bij registreren, omzetten en wachtwoord wijzigen meekomen.
function keyFields(b, { pubkey = true } = {}) {
  return {
    auth: b64field(b.auth, 40, 64, 'inlogcode'),
    salt: b64field(b.salt, 20, 32, 'salt'),
    pubkey: pubkey ? b64field(b.pubkey, 80, 100, 'sleutel') : null,
    enc_privkey: b64field(b.enc_privkey, 100, 400, 'sleutel')
  };
}

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

// Ontsleutelen met de sleutel van één bericht (alleen bij een melding). Formaat: iv (12) + ciphertext.
async function openWithKey(keyB64, data) {
  const key = await crypto.subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  const bytes = typeof data === 'string' ? fromB64(data) : data;
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}

function parseEnvelope(s) {
  try {
    const e = JSON.parse(s);
    if (Number.isInteger(e.kv) && typeof e.wk === 'string' && typeof e.c === 'string') return e;
  } catch {}
  return null;
}

// Een versleuteld bericht: { kv: sleutelversie, wk: berichtsleutel ingepakt met de gesprekssleutel, c: tekst }.
function checkEnvelope(s, conv) {
  const text = String(s ?? '');
  const e = text.length <= 16000 ? parseEnvelope(text) : null;
  if (!e || e.kv < 1 || e.kv > conv.key_version || e.wk.length > 200 || !B64_RE.test(e.wk) || !B64_RE.test(e.c)) {
    throw new HttpError(400, 'Ongeldig versleuteld bericht; ververs de pagina');
  }
  return JSON.stringify({ kv: e.kv, wk: e.wk, c: e.c });
}

// ---------- Account ----------

async function fakeSalt(login) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`skitta-salt|${login}`)));
  return toB64(d.slice(0, 16));
}

// Stap 1 van inloggen: de salt om de inlogcode en sleutel uit het wachtwoord af te leiden.
async function prelogin(env, request) {
  const b = await body(request);
  const id = str(b.login, 200).toLowerCase();
  const user = await env.DB.prepare('SELECT kdf_salt, kdf_v FROM users WHERE username = ? OR email = ?').bind(id, id).first();
  if (user?.kdf_v === 0) return json({ v: 0 });
  return json({ v: 1, salt: user?.kdf_salt || await fakeSalt(id) });
}

async function register(env, request) {
  if ((await setting(env, 'registration', 'open')) !== 'open') throw new HttpError(403, 'Nieuwe accounts maken is op dit moment uitgeschakeld');
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `reg|${ip}`, 5, 3600e3)) throw new HttpError(429, 'Te veel pogingen, probeer het later opnieuw');
  const b = await body(request);
  const username = str(b.username, 32).toLowerCase();
  const displayName = str(b.display_name, 60);
  const email = str(b.email, 200).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Skittanaam: 3–32 tekens, begint met een letter; kleine letters, cijfers, . _ of -');
  if (displayName.length < 2) throw new HttpError(400, 'Vul je naam in');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Vul een geldig e-mailadres in');
  const k = keyFields(b);
  const exists = await env.DB.prepare('SELECT username FROM users WHERE username = ? OR email = ?').bind(username, email).first();
  if (exists) throw new HttpError(409, exists.username === username ? 'Deze Skittanaam is al bezet' : 'Er is al een account met dit e-mailadres');
  await recordAttempt(env, `reg|${ip}`);

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const user = await env.DB.prepare(
    `INSERT INTO users (username, display_name, email, password_hash, kdf_salt, kdf_v, pubkey, enc_privkey, is_admin, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?) RETURNING id`
  ).bind(username, displayName, email, await hashPassword(k.auth), k.salt, k.pubkey, k.enc_privkey, n === 0 ? 1 : 0, now()).first();
  return sessionResponse(env, user.id, b, 201);
}

async function sessionResponse(env, userId, b, status = 200) {
  if (b.app) {
    // Desktop- of Android-app: token in de response in plaats van een cookie.
    const token = randomToken(32);
    await createSession(env, userId, true, token);
    return json({ ok: true, id: userId, token }, status);
  }
  return json({ ok: true, id: userId }, status, { 'set-cookie': await createSession(env, userId, b.remember !== false) });
}

// Een oud account (kdf_v 0, of na een wachtwoordreset door de beheerder) logt één keer in met het
// wachtwoord zelf en zet tegelijk de inlogcode en een nieuw sleutelpaar.
async function upgradeAccount(env, userId, upgrade) {
  const k = keyFields(upgrade || {});
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, kdf_salt = ?, kdf_v = 1, pubkey = ?, enc_privkey = ? WHERE id = ?'
  ).bind(await hashPassword(k.auth), k.salt, k.pubkey, k.enc_privkey, userId).run();
  // Medeleden laten weten dat ze de gesprekssleutels opnieuw voor deze persoon moeten inpakken.
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT o.user_id FROM members m JOIN members o ON o.conversation_id = m.conversation_id
      WHERE m.user_id = ? AND o.left_at IS NULL`
  ).bind(userId).all();
  await hub(env).notify(results.map((r) => r.user_id), { t: 'conv' });
}

async function login(env, request) {
  const b = await body(request);
  const id = str(b.login, 200).toLowerCase();
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `login|${ip}`, 20, 900e3) || await tooManyAttempts(env, `login|${id}`, 10, 900e3)) {
    throw new HttpError(429, 'Te veel mislukte pogingen. Wacht een kwartier en probeer het opnieuw.');
  }
  const user = await env.DB.prepare('SELECT id, password_hash, status, kdf_v FROM users WHERE username = ? OR email = ?').bind(id, id).first();
  const secret = user?.kdf_v === 0 ? b.password : b.auth;
  if (!user || !(await verifyPassword(String(secret ?? ''), user.password_hash))) {
    await recordAttempt(env, `login|${ip}`);
    await recordAttempt(env, `login|${id}`);
    throw new HttpError(401, 'Je Skittanaam of wachtwoord klopt niet');
  }
  if (user.status !== 'active') throw new HttpError(403, 'Dit account is geblokkeerd door de beheerder');
  if (user.kdf_v === 0) await upgradeAccount(env, user.id, b.upgrade);
  if (PRESENCES.includes(b.presence)) await env.DB.prepare('UPDATE users SET presence = ? WHERE id = ?').bind(b.presence, user.id).run();
  return sessionResponse(env, user.id, b);
}

// Al ingelogd van vóór de versleuteling: met het wachtwoord omzetten.
async function upgradeMe(env, user, request) {
  const b = await body(request);
  const row = await env.DB.prepare('SELECT password_hash, kdf_v FROM users WHERE id = ?').bind(user.id).first();
  if (row.kdf_v !== 0) throw new HttpError(409, 'Je account is al omgezet');
  if (!(await verifyPassword(String(b.password ?? ''), row.password_hash))) throw new HttpError(400, 'Wachtwoord klopt niet');
  await upgradeAccount(env, user.id, b.upgrade);
  return json({ ok: true });
}

function meOut(env, user, announcement) {
  return {
    ...publicUser(user), email: user.email, presence_pref: user.presence, is_admin: !!user.is_admin,
    announcement, read_receipts: !!user.read_receipts, big_files: env.FILES_URL && env.FILES_SECRET ? BIG.min : 0, kdf_v: user.kdf_v, kdf_salt: user.kdf_salt, pubkey: user.pubkey, enc_privkey: user.enc_privkey
  };
}

async function updateMe(env, user, request) {
  const b = await body(request);
  const sets = [];
  const vals = [];
  if ('display_name' in b) {
    const v = str(b.display_name, 60);
    if (v.length < 2) throw new HttpError(400, 'Vul je naam in');
    sets.push('display_name = ?'); vals.push(v);
  }
  if ('mood' in b) { sets.push('mood = ?'); vals.push(str(b.mood, 200)); }
  if ('email' in b) {
    const v = str(b.email, 200).toLowerCase();
    if (!EMAIL_RE.test(v)) throw new HttpError(400, 'Vul een geldig e-mailadres in');
    const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(v, user.id).first();
    if (taken) throw new HttpError(409, 'Er is al een account met dit e-mailadres');
    sets.push('email = ?'); vals.push(v);
  }
  if ('presence' in b) {
    if (!PRESENCES.includes(b.presence)) throw new HttpError(400, 'Onbekende status');
    sets.push('presence = ?'); vals.push(b.presence);
  }
  if ('read_receipts' in b) { sets.push('read_receipts = ?'); vals.push(b.read_receipts ? 1 : 0); }
  if (!sets.length) return json({ ok: true });
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, user.id).run();
  if ('presence' in b) await hub(env).presenceChanged(user.id);
  if ('display_name' in b || 'mood' in b) await notifyContacts(env, user.id, { t: 'contacts' });
  return json({ ok: true });
}

// Nieuw wachtwoord: de browser pakt hetzelfde sleutelpaar opnieuw in met de nieuwe sleutel.
async function changePassword(env, user, request) {
  const b = await body(request);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(String(b.current_auth ?? ''), row.password_hash))) throw new HttpError(400, 'Huidig wachtwoord klopt niet');
  const k = keyFields(b, { pubkey: false });
  await env.DB.prepare('UPDATE users SET password_hash = ?, kdf_salt = ?, enc_privkey = ? WHERE id = ?')
    .bind(await hashPassword(k.auth), k.salt, k.enc_privkey, user.id).run();
  return json({ ok: true });
}

async function notifyContacts(env, uid, event) {
  const { results } = await env.DB.prepare("SELECT contact_id FROM contacts WHERE user_id = ? AND state = 'ok'").bind(uid).all();
  await hub(env).notify([uid, ...results.map((r) => r.contact_id)], event);
}

// ---------- Afbeeldingen ----------

function sniffImage(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function readImage(env, request) {
  const max = 600_000;
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'Deze foto is te groot');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'Geen foto ontvangen');
  if (buf.length > max) throw new HttpError(413, 'Deze foto is te groot');
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, 'Alleen JPEG-, PNG-, GIF- of WebP-afbeeldingen');
  return { buf, mime };
}

function mediaInsert(env, id, ownerId, convId, img, w, h) {
  const inR2 = 1;
  return env.DB.prepare(
    'INSERT INTO media (id, owner_id, conversation_id, mime, size, width, height, in_r2, data, created_at, enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, ownerId, convId, img.mime, img.buf.length, w || null, h || null, inR2, null, now(), img.enc ? 1 : 0);
}

async function readEncrypted(env, request) {
  const max = LIMITS.fileBytes + 64;
  if (Number(request.headers.get('content-length') || 0) > max) throw new HttpError(413, 'Deze foto is te groot');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length < 29) throw new HttpError(400, 'Geen foto ontvangen');
  if (buf.length > max) throw new HttpError(413, 'Deze foto is te groot');
  return { buf, mime: 'application/octet-stream', enc: true };
}

// Nieuwe bijlagen gaan altijd naar R2 (D1 is alleen nog voor oude foto's van vóór R2).
async function mediaStore(env, uid, id, img) {
  if (!env.MEDIA) throw new HttpError(503, 'Bijlagen versturen kan nu niet');
  await checkUpload(env, uid, img.buf.length);
  await env.MEDIA.put(`media/${id}`, img.buf, { httpMetadata: { contentType: img.mime } });
  await env.DB.batch([bump(env, usageKey.write()), bump(env, usageKey.upload(uid), img.buf.length)]);
}

async function mediaDelete(env, ids) {
  const list = ids.filter(Boolean);
  if (!list.length) return;
  if (env.MEDIA) await env.MEDIA.delete(list.map((id) => `media/${id}`));
  await Promise.all(list.map((id) => caches.default.delete(new Request(`https://media.skitta.internal/${id}`)).catch(() => {})));
  await env.DB.prepare(`DELETE FROM media WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).run();
}

// Een foto waar een melding naar verwijst, blijft bewaard zodat de beheerder hem kan bekijken.
async function dropMedia(env, mediaId) {
  if (!mediaId) return;
  if (await env.DB.prepare('SELECT 1 FROM reports WHERE media_id = ?').bind(mediaId).first()) return;
  await mediaDelete(env, [mediaId]);
}

async function r2Bytes(env, id) {
  const cacheKey = new Request(`https://media.skitta.internal/${id}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  if (!(await canRead(env))) throw new HttpError(429, 'Skitta heeft deze maand te veel bijlagen geladen. Volgende maand kan het weer.');
  const obj = await env.MEDIA?.get(`media/${id}`);
  if (!obj) throw new HttpError(404, 'Niet gevonden');
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const put = caches.default.put(cacheKey, new Response(bytes, { headers: { 'cache-control': 'public, max-age=2592000' } }));
  const count = bump(env, usageKey.read()).run();
  if (env.ctx) env.ctx.waitUntil(Promise.all([put, count]));
  else await Promise.all([put, count]);
  return bytes;
}

async function mediaResponse(env, row, cache = 'private, max-age=31536000, immutable') {
  let data = row.data;
  if (row.in_r2) {
    data = await r2Bytes(env, row.id);
  } else if (Array.isArray(data)) {
    data = new Uint8Array(data);
  }
  return new Response(data, {
    headers: {
      'content-type': row.mime, 'cache-control': cache, 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
    }
  });
}

// Profielfoto's mag iedereen zien; een foto in een gesprek alleen de leden, en alleen zolang het
// bericht nog bestaat (een verwijderde of afgekeurde foto blijft alleen voor de beheerder bewaard).
async function getMedia(env, user, id) {
  const row = await env.DB.prepare(
    `SELECT m.* FROM media m
      WHERE m.id = ? AND (m.conversation_id IS NULL OR (
            EXISTS (SELECT 1 FROM members x WHERE x.conversation_id = m.conversation_id AND x.user_id = ?)
        AND EXISTS (SELECT 1 FROM messages y WHERE y.media_id = m.id)))`
  ).bind(id, user.id).first();
  if (!row) throw new HttpError(404, 'Niet gevonden');
  return mediaResponse(env, row);
}

async function setAvatar(env, user, request) {
  const img = await readImage(env, request);
  if (img.buf.length > 600_000) throw new HttpError(413, 'Deze foto is te groot');
  const id = randomToken(18);
  await mediaStore(env, user.id, id, img);
  await env.DB.batch([
    mediaInsert(env, id, user.id, null, img, 0, 0),
    env.DB.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').bind(id, user.id)
  ]);
  await mediaDelete(env, [user.avatar_id]);
  await notifyContacts(env, user.id, { t: 'contacts' });
  return json({ avatar: id });
}

async function removeAvatar(env, user) {
  await env.DB.prepare('UPDATE users SET avatar_id = NULL WHERE id = ?').bind(user.id).run();
  await mediaDelete(env, [user.avatar_id]);
  await notifyContacts(env, user.id, { t: 'contacts' });
  return json({ ok: true });
}

// ---------- Pushmeldingen ----------

// Alleen naar wie geen open (en actieve) Skitta heeft; anders meldt de app het zelf.
async function pushAway(env, userIds, payload, opts) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const states = await hub(env).states(ids);
  const away = ids.filter((id) => !states[id]?.conns || states[id]?.idle);
  if (away.length) await pushTo(env, away, payload, opts);
}

function later(env, promise) {
  if (env.ctx) env.ctx.waitUntil(promise.catch((e) => console.error(e)));
}

async function pushMessage(env, user, conv, m) {
  const { results } = await env.DB.prepare(
    'SELECT user_id FROM members WHERE conversation_id = ? AND left_at IS NULL AND user_id != ? AND muted_until < ?'
  ).bind(conv.id, user.id, now()).all();
  const others = results.map((r) => r.user_id);
  const title = conv.kind === 'group' ? `${user.display_name} in ${conv.topic || 'een groep'}` : user.display_name;
  const body = m.kind === 'call' ? 'Gemiste oproep' : m.kind === 'photo' ? 'Heeft een bijlage gestuurd' : 'Nieuw bericht';
  if (m.kind === 'call' && !JSON.parse(m.body || '{}').missed) return;
  await pushAway(env, others, { t: 'msg', c: conv.id, title, body, tag: `c${conv.id}` });
}

async function pushSubscribe(env, user, request) {
  const b = await body(request);
  const endpoint = str(b.endpoint, 1000);
  if (!/^https:\/\//.test(endpoint)) throw new HttpError(400, 'Ongeldig abonnement');
  const p256dh = str(b.keys?.p256dh, 200);
  const auth = str(b.keys?.auth, 100);
  if (!p256dh || !auth) throw new HttpError(400, 'Ongeldig abonnement');
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(endpoint, user.id, p256dh, auth, now()).run();
  return json({ ok: true });
}

async function pushUnsubscribe(env, user, request) {
  const b = await body(request);
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(str(b.endpoint, 1000), user.id).run();
  return json({ ok: true });
}

// ---------- Contactpersonen ----------

async function listContacts(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT c.state, c.message, c.created_at AS since, u.id, u.username, u.display_name, u.mood, u.avatar_id, u.presence, u.last_seen
       FROM contacts c JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = ? AND u.status = 'active'`
  ).bind(user.id).all();
  const ok = results.filter((r) => r.state === 'ok').map((r) => r.id);
  const states = ok.length ? await hub(env).states(ok) : {};
  return json(results.map((r) => ({
    ...publicUser(r, r.state === 'ok' ? effectivePresence(r.presence, states[r.id]?.conns, states[r.id]?.idle) : 'unknown'),
    state: r.state, message: r.state === 'in' ? r.message : '', since: r.since,
    last_seen: r.state === 'ok' && r.presence !== 'invisible' ? r.last_seen : null
  })));
}

async function searchUsers(env, user, url) {
  const q = str(url.searchParams.get('q'), 60).toLowerCase();
  if (q.length < 2) return json([]);
  const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, username, display_name, mood, avatar_id FROM users
      WHERE status = 'active' AND id != ? AND (username LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\' OR email = ?)
      ORDER BY username = ? DESC, display_name LIMIT 20`
  ).bind(user.id, like, like, q, q).all();
  return json(results.map((r) => publicUser(r)));
}

async function contactRow(env, a, b) {
  return env.DB.prepare('SELECT state FROM contacts WHERE user_id = ? AND contact_id = ?').bind(a, b).first();
}

async function addContact(env, user, request) {
  const b = await body(request);
  const other = await env.DB.prepare("SELECT id FROM users WHERE (id = ? OR username = ?) AND status = 'active'")
    .bind(Number(b.user_id) || 0, str(b.username, 32).toLowerCase()).first();
  if (!other) throw new HttpError(404, 'Deze persoon bestaat niet');
  if (other.id === user.id) throw new HttpError(400, 'Je kunt jezelf niet toevoegen');
  const mine = await contactRow(env, user.id, other.id);
  const theirs = await contactRow(env, other.id, user.id);
  if (mine?.state === 'ok') return json({ state: 'ok' });
  const t = now();
  const message = str(b.message, 300) || 'Hallo, ik wil je graag toevoegen aan mijn lijst met contactpersonen.';
  if (mine?.state === 'in') return acceptContact(env, user, other.id);
  if (await tooManyAttempts(env, `contact|${user.id}`, 30, 3600e3)) throw new HttpError(429, 'Te veel verzoeken, probeer het later opnieuw');
  await recordAttempt(env, `contact|${user.id}`);
  const stmts = [
    env.DB.prepare(
      "INSERT INTO contacts (user_id, contact_id, state, created_at) VALUES (?, ?, 'out', ?) ON CONFLICT DO UPDATE SET state = 'out', created_at = excluded.created_at"
    ).bind(user.id, other.id, t)
  ];
  // Wie jou geblokkeerd heeft, krijgt het verzoek niet te zien (en jij merkt dat niet).
  if (theirs?.state !== 'blocked') {
    stmts.push(env.DB.prepare(
      "INSERT INTO contacts (user_id, contact_id, state, message, created_at) VALUES (?, ?, 'in', ?, ?) ON CONFLICT DO UPDATE SET state = 'in', message = excluded.message, created_at = excluded.created_at"
    ).bind(other.id, user.id, message, t));
  }
  await env.DB.batch(stmts);
  if (theirs?.state !== 'blocked') {
    await hub(env).notify([other.id], { t: 'contacts', request: user.id });
    later(env, pushAway(env, [other.id], { t: 'contact', title: user.display_name, body: 'wil je toevoegen als contactpersoon', tag: `r${user.id}` }));
  }
  await hub(env).notify([user.id], { t: 'contacts' });
  return json({ state: 'out' }, 201);
}

async function acceptContact(env, user, otherId) {
  const mine = await contactRow(env, user.id, otherId);
  if (mine?.state !== 'in') throw new HttpError(404, 'Geen verzoek gevonden');
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE contacts SET state = 'ok', message = '', created_at = ? WHERE user_id = ? AND contact_id = ?").bind(t, user.id, otherId),
    env.DB.prepare(
      "INSERT INTO contacts (user_id, contact_id, state, created_at) VALUES (?, ?, 'ok', ?) ON CONFLICT DO UPDATE SET state = 'ok', message = ''"
    ).bind(otherId, user.id, t)
  ]);
  await hub(env).notify([otherId], { t: 'contacts', accepted: user.id });
  await hub(env).notify([user.id], { t: 'contacts' });
  // Allebei elkaars status laten zien.
  await hub(env).presenceChanged(user.id);
  await hub(env).presenceChanged(otherId);
  return json({ state: 'ok' });
}

async function removeContact(env, user, otherId) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND state != 'blocked'").bind(user.id, otherId),
    env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND state != 'blocked'").bind(otherId, user.id)
  ]);
  await hub(env).notify([user.id, otherId], { t: 'contacts' });
  return json({ ok: true });
}

async function blockContact(env, user, otherId, on) {
  if (on) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO contacts (user_id, contact_id, state, created_at) VALUES (?, ?, 'blocked', ?) ON CONFLICT DO UPDATE SET state = 'blocked', message = ''"
      ).bind(user.id, otherId, now()),
      env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND state != 'blocked'").bind(otherId, user.id)
    ]);
  } else {
    await env.DB.prepare("DELETE FROM contacts WHERE user_id = ? AND contact_id = ? AND state = 'blocked'").bind(user.id, otherId).run();
  }
  await hub(env).notify([user.id, otherId], { t: 'contacts' });
  return json({ ok: true });
}

// ---------- Gesprekken ----------

async function memberOf(env, user, convId, active = true) {
  const row = await env.DB.prepare(
    `SELECT c.*, m.left_at, m.last_read FROM conversations c JOIN members m ON m.conversation_id = c.id
      WHERE c.id = ? AND m.user_id = ?`
  ).bind(convId, user.id).first();
  if (!row) throw new HttpError(404, 'Gesprek niet gevonden');
  if (active && row.left_at) throw new HttpError(403, 'Je zit niet meer in dit gesprek');
  return row;
}

async function activeMemberIds(env, convId) {
  const { results } = await env.DB.prepare('SELECT user_id FROM members WHERE conversation_id = ? AND left_at IS NULL').bind(convId).all();
  return results.map((r) => r.user_id);
}

function msgOut(m) {
  const gone = m.deleted_at || m.removed;
  return {
    id: m.id, c: m.conversation_id, u: m.sender_id, k: m.kind, b: gone ? '' : m.body,
    media: gone ? null : m.media_id, w: m.width || null, h: m.height || null,
    at: m.created_at, ed: m.edited_at || null, del: !!m.deleted_at, rm: !!m.removed, cid: m.client_id || null,
    e: m.enc && !gone ? 1 : 0, x: m.expires_at || null,
    re: gone || !m.reacts ? [] : JSON.parse(m.reacts)
  };
}

const MSG_COLS = `m.*, x.width, x.height,
  (SELECT json_group_array(json_object('u', r.user_id, 'b', r.body)) FROM reactions r WHERE r.message_id = m.id) AS reacts`;
const EXPIRES = [0, 300, 3600, 28800, 86400, 604800, 2419200];
const MSG_FROM = 'messages m LEFT JOIN media x ON x.id = m.media_id';

async function conversationsFor(env, user, onlyId) {
  const { results: convs } = await env.DB.prepare(
    `SELECT c.id, c.kind, c.topic, c.created_by, c.created_at, c.last_at, c.key_version, c.rotate, c.expire,
            m.left_at, m.last_read, m.muted_until, m.pinned, m.archived,
            (SELECT COUNT(*) FROM messages z WHERE z.conversation_id = c.id AND z.id > m.last_read
               AND (z.sender_id IS NULL OR z.sender_id != ?) AND z.kind != 'system' AND z.deleted_at IS NULL) AS unread
       FROM members m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.user_id = ? ${onlyId ? 'AND c.id = ?' : ''}
      ORDER BY c.last_at DESC LIMIT 300`
  ).bind(...[user.id, user.id, ...(onlyId ? [onlyId] : [])]).all();
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const marks = ids.map(() => '?').join(',');
  const [members, lasts, keyed] = await env.DB.batch([
    env.DB.prepare(
      `SELECT m.conversation_id, m.left_at, m.last_read, u.id, u.username, u.display_name, u.mood, u.avatar_id, u.pubkey, u.read_receipts
         FROM members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id IN (${marks})`
    ).bind(...ids),
    env.DB.prepare(
      `SELECT ${MSG_COLS} FROM ${MSG_FROM}
        WHERE m.id IN (SELECT MAX(id) FROM messages WHERE conversation_id IN (${marks}) GROUP BY conversation_id)`
    ).bind(...ids),
    // Wie heeft de huidige gesprekssleutel, ingepakt voor zijn huidige publieke sleutel?
    env.DB.prepare(
      `SELECT k.conversation_id, k.user_id FROM conv_keys k
         JOIN conversations c ON c.id = k.conversation_id AND k.version = c.key_version
         JOIN users u ON u.id = k.user_id AND u.pubkey = k.pubkey
        WHERE k.conversation_id IN (${marks})`
    ).bind(...ids)
  ]);
  const hasKey = new Set(keyed.results.map((r) => `${r.conversation_id}:${r.user_id}`));
  const byConv = new Map(ids.map((id) => [id, []]));
  for (const m of members.results) {
    // Leesbevestigingen zijn wederzijds: staat iemand ze uit, dan ziet niemand die van een ander.
    const read = m.id === user.id || (m.read_receipts && user.read_receipts) ? m.last_read : 0;
    byConv.get(m.conversation_id).push({ ...publicUser(m), pubkey: m.pubkey || null, left: !!m.left_at, read });
  }
  const last = new Map(lasts.results.map((m) => [m.conversation_id, msgOut(m)]));
  return convs.map((c) => ({
    id: c.id, kind: c.kind, topic: c.topic, created_by: c.created_by, last_at: c.last_at,
    left: !!c.left_at, last_read: c.last_read, unread: c.unread, key_version: c.key_version, rotate: !!c.rotate,
    expire: c.expire, muted_until: c.muted_until, pinned: !!c.pinned, archived: !!c.archived,
    members: byConv.get(c.id), last: last.get(c.id) || null,
    missing: c.key_version ? byConv.get(c.id).filter((m) => !m.left && m.pubkey && !hasKey.has(`${c.id}:${m.id}`)).map((m) => m.id) : []
  }));
}

// ---------- Gesprekssleutels ----------

// Mijn ingepakte gesprekssleutels (alleen die voor mijn huidige publieke sleutel).
async function listKeys(env, user, url) {
  const c = Number(url.searchParams.get('c')) || 0;
  const { results } = await env.DB.prepare(
    `SELECT conversation_id AS c, version AS v, wrapped AS w FROM conv_keys
      WHERE user_id = ? AND pubkey = ? ${c ? 'AND conversation_id = ?' : ''}`
  ).bind(...[user.id, user.pubkey || '', ...(c ? [c] : [])]).all();
  return json(results);
}

// Sleutels opslaan. rotate: een nieuwe versie (voor alle leden tegelijk). Anders: een sleutel die ik al heb
// inpakken voor iemand die hem mist (nieuw lid, of iemand met een nieuw sleutelpaar).
async function putKeys(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  if (!user.pubkey) throw new HttpError(409, 'Je hebt nog geen sleutel');
  const b = await body(request);
  const list = (Array.isArray(b.keys) ? b.keys : []).slice(0, 500);
  if (!list.length) throw new HttpError(400, 'Geen sleutels');
  const { results } = await env.DB.prepare(
    'SELECT u.id, u.pubkey FROM members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.left_at IS NULL'
  ).bind(convId).all();
  const pubs = new Map(results.filter((r) => r.pubkey).map((r) => [r.id, r.pubkey]));
  const rows = list.map((k) => ({
    user_id: Number(k.user_id), version: Number(k.version),
    wrapped: str(k.wrapped, 400)
  })).filter((k) => pubs.has(k.user_id) && k.wrapped);
  const t = now();
  const insert = (k) => env.DB.prepare(
    `INSERT INTO conv_keys (conversation_id, user_id, version, wrapped, pubkey, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET wrapped = excluded.wrapped, pubkey = excluded.pubkey, created_at = excluded.created_at
     WHERE conv_keys.pubkey != excluded.pubkey`
  ).bind(convId, k.user_id, k.version, k.wrapped, pubs.get(k.user_id), t);

  if (b.rotate) {
    const v = conv.key_version + 1;
    if (rows.some((k) => k.version !== v)) throw new HttpError(409, 'Er is net een nieuwe sleutel gemaakt');
    if (!rows.some((k) => k.user_id === user.id)) throw new HttpError(400, 'Ongeldige sleutels');
    const missing = [...pubs.keys()].filter((id) => !rows.some((k) => k.user_id === id));
    if (missing.length) throw new HttpError(409, 'De leden van het gesprek zijn veranderd');
    const res = await env.DB.prepare('UPDATE conversations SET key_version = ?, rotate = 0 WHERE id = ? AND key_version = ?')
      .bind(v, convId, conv.key_version).run();
    if (!res.meta.changes) throw new HttpError(409, 'Er is net een nieuwe sleutel gemaakt');
    await env.DB.batch(rows.map(insert));
  } else {
    const { results: mine } = await env.DB.prepare('SELECT version FROM conv_keys WHERE conversation_id = ? AND user_id = ? AND pubkey = ?')
      .bind(convId, user.id, user.pubkey).all();
    const held = new Set(mine.map((r) => r.version));
    const ok = rows.filter((k) => held.has(k.version) && k.version <= conv.key_version);
    if (!ok.length) return json({ ok: true });
    await env.DB.batch(ok.map(insert));
  }
  await hub(env).notify([...new Set(rows.map((k) => k.user_id))], { t: 'keys', c: convId });
  return json({ ok: true, key_version: b.rotate ? conv.key_version + 1 : conv.key_version });
}

async function listConversations(env, user) {
  return json(await conversationsFor(env, user));
}

async function isContact(env, a, b) {
  return (await contactRow(env, a, b))?.state === 'ok';
}

async function createConversation(env, user, request) {
  const b = await body(request);
  const t = now();
  if (b.user_id) {
    const other = Number(b.user_id);
    if (!(await isContact(env, user.id, other))) throw new HttpError(403, 'Je kunt alleen chatten met je contactpersonen');
    const key = [user.id, other].sort((x, y) => x - y).join(':');
    let conv = await env.DB.prepare('SELECT id FROM conversations WHERE direct_key = ?').bind(key).first();
    if (!conv) {
      conv = await env.DB.prepare(
        "INSERT INTO conversations (kind, direct_key, created_by, created_at, last_at) VALUES ('direct', ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id"
      ).bind(key, user.id, t, t).first() || await env.DB.prepare('SELECT id FROM conversations WHERE direct_key = ?').bind(key).first();
      await env.DB.batch([user.id, other].map((uid) =>
        env.DB.prepare('INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(conv.id, uid, t)
      ));
    }
    const [out] = await conversationsFor(env, user, conv.id);
    return json(out);
  }

  // Groepsgesprek met contactpersonen.
  const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(Number).filter((id) => id && id !== user.id))];
  if (!ids.length) throw new HttpError(400, 'Kies minstens één contactpersoon');
  if (ids.length + 1 > MAX_GROUP) throw new HttpError(400, `Een groep kan maximaal ${MAX_GROUP} personen hebben`);
  for (const id of ids) if (!(await isContact(env, user.id, id))) throw new HttpError(403, 'Je kunt alleen contactpersonen toevoegen');
  const topic = str(b.topic, 100);
  const conv = await env.DB.prepare(
    "INSERT INTO conversations (kind, topic, created_by, created_at, last_at) VALUES ('group', ?, ?, ?, ?) RETURNING id"
  ).bind(topic, user.id, t, t).first();
  await env.DB.batch([
    ...[user.id, ...ids].map((uid) =>
      env.DB.prepare('INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').bind(conv.id, uid, t)),
    systemMessage(env, conv.id, user.id, { e: 'created', ids }, t)
  ]);
  await hub(env).notify([user.id, ...ids], { t: 'conv', c: conv.id, added: ids });
  const [out] = await conversationsFor(env, user, conv.id);
  return json(out, 201);
}

function systemMessage(env, convId, senderId, data, t = now()) {
  return env.DB.prepare(
    "INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, 'system', ?, ?)"
  ).bind(convId, senderId, JSON.stringify(data), t);
}

async function updateConversation(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  if (conv.kind !== 'group') throw new HttpError(400, 'Alleen groepen hebben een onderwerp');
  const b = await body(request);
  const topic = str(b.topic, 100);
  await env.DB.batch([
    env.DB.prepare('UPDATE conversations SET topic = ?, last_at = ? WHERE id = ?').bind(topic, now(), convId),
    systemMessage(env, convId, user.id, { e: 'topic', topic })
  ]);
  await broadcastLatest(env, convId);
  return json({ ok: true });
}

async function addMembers(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  if (conv.kind !== 'group') throw new HttpError(400, 'Maak eerst een groep om meer mensen toe te voegen');
  const b = await body(request);
  const current = await activeMemberIds(env, convId);
  const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(Number))].filter((id) => id && !current.includes(id));
  if (!ids.length) return json({ ok: true });
  if (current.length + ids.length > MAX_GROUP) throw new HttpError(400, `Een groep kan maximaal ${MAX_GROUP} personen hebben`);
  for (const id of ids) if (!(await isContact(env, user.id, id))) throw new HttpError(403, 'Je kunt alleen contactpersonen toevoegen');
  const t = now();
  await env.DB.batch([
    ...ids.map((uid) => env.DB.prepare(
      'INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at'
    ).bind(convId, uid, t)),
    systemMessage(env, convId, user.id, { e: 'added', ids }, t),
    env.DB.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(t, convId)
  ]);
  await hub(env).notify(ids, { t: 'conv', c: convId, added: ids });
  await broadcastLatest(env, convId);
  return json({ ok: true });
}

async function leaveConversation(env, user, convId) {
  const conv = await memberOf(env, user, convId);
  if (conv.kind !== 'group') throw new HttpError(400, 'Je kunt een gesprek met één persoon niet verlaten');
  const t = now();
  await env.DB.batch([
    systemMessage(env, convId, user.id, { e: 'left' }, t),
    env.DB.prepare('UPDATE members SET left_at = ? WHERE conversation_id = ? AND user_id = ?').bind(t, convId, user.id),
    env.DB.prepare('UPDATE conversations SET last_at = ?, rotate = 1 WHERE id = ?').bind(t, convId)
  ]);
  await broadcastLatest(env, convId, [user.id]);
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'conv', c: convId });
  await hub(env).notify([user.id], { t: 'conv', c: convId });
  return json({ ok: true });
}

// Stuur het nieuwste bericht (bijv. een systeemmelding) naar alle leden.
async function broadcastLatest(env, convId, extra = []) {
  const m = await env.DB.prepare(`SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`).bind(convId).first();
  const ids = await activeMemberIds(env, convId);
  if (m) await hub(env).notify([...ids, ...extra], { t: 'msg', m: msgOut(m) });
}

async function listMessages(env, user, convId, url) {
  const conv = await memberOf(env, user, convId, false);
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const after = Number(url.searchParams.get('after')) || 0;
  const until = conv.left_at ? `AND m.created_at <= ${Number(conv.left_at)}` : '';
  const filter = `AND (m.expires_at IS NULL OR m.expires_at > ${now()})
    AND m.id NOT IN (SELECT message_id FROM hidden WHERE user_id = ${Number(user.id)})`;
  const { results } = after
    ? await env.DB.prepare(
      `SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.conversation_id = ? AND m.id > ? ${until} ${filter} ORDER BY m.id LIMIT 500`
    ).bind(convId, after).all()
    : await env.DB.prepare(
      `SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.conversation_id = ? AND m.id < ? ${until} ${filter} ORDER BY m.id DESC LIMIT ${PAGE}`
    ).bind(convId, before).all();
  const list = after ? results : results.reverse();
  return json({ messages: list.map(msgOut), more: !after && results.length === PAGE });
}

async function canMessage(env, user, conv) {
  if (conv.kind !== 'direct') return;
  const other = conv.direct_key.split(':').map(Number).find((id) => id !== user.id);
  if (!(await isContact(env, user.id, other))) throw new HttpError(403, 'Je kunt deze persoon geen berichten meer sturen');
}

async function sendMessage(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  await canMessage(env, user, conv);
  const b = await body(request);
  const kind = b.kind === 'call' ? 'call' : 'text';
  let text;
  const enc = kind === 'text' && b.enc ? 1 : 0;
  if (enc) {
    text = checkEnvelope(b.body, conv);
  } else if (kind === 'call') {
    const dur = Math.max(0, Math.min(86400, Math.round(Number(b.duration) || 0)));
    text = JSON.stringify({ dur, missed: !!b.missed && !dur, video: !!b.video, failed: !!b.failed && !dur });
  } else {
    text = String(b.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);
    if (!text) throw new HttpError(400, 'Leeg bericht');
  }
  if (await tooManyAttempts(env, `msg|${user.id}`, 120, 60e3)) throw new HttpError(429, 'Je stuurt te veel berichten tegelijk');
  await recordAttempt(env, `msg|${user.id}`);
  const t = now();
  const cid = str(b.client_id, 40) || null;
  const [res] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO messages (conversation_id, sender_id, kind, body, client_id, created_at, enc, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
    ).bind(convId, user.id, kind, text, cid, t, enc, conv.expire && kind !== 'call' ? t + conv.expire * 1000 : null),
    env.DB.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(t, convId),
    env.DB.prepare('UPDATE members SET last_read = (SELECT MAX(id) FROM messages WHERE conversation_id = ?) WHERE conversation_id = ? AND user_id = ?').bind(convId, convId, user.id)
  ]);
  const m = msgOut(res.results[0]);
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'msg', m });
  later(env, pushMessage(env, user, conv, res.results[0]));
  return json(m, 201);
}

async function sendPhoto(env, user, convId, request, url) {
  const conv = await memberOf(env, user, convId);
  await canMessage(env, user, conv);
  if (await tooManyAttempts(env, `photo|${user.id}`, 60, 3600e3)) throw new HttpError(429, 'Je stuurt te veel foto\'s, probeer het later opnieuw');
  const enc = url.searchParams.get('enc') === '1' ? 1 : 0;
  const img = enc ? await readEncrypted(env, request) : await readImage(env, request);
  await recordAttempt(env, `photo|${user.id}`);
  const w = Math.min(20000, Number(url.searchParams.get('w')) || 0);
  const h = Math.min(20000, Number(url.searchParams.get('h')) || 0);
  const cid = str(url.searchParams.get('cid'), 40) || null;
  const caption = enc ? checkEnvelope(request.headers.get('x-skitta-body'), conv) : str(url.searchParams.get('caption'), 1000);
  const id = randomToken(18);
  const t = now();
  await mediaStore(env, user.id, id, img);
  const [, res] = await env.DB.batch([
    mediaInsert(env, id, user.id, convId, img, w, h),
    env.DB.prepare(
      "INSERT INTO messages (conversation_id, sender_id, kind, body, media_id, client_id, created_at, enc, expires_at) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(convId, user.id, caption, id, cid, t, enc, conv.expire ? t + conv.expire * 1000 : null),
    env.DB.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(t, convId),
    env.DB.prepare('UPDATE members SET last_read = (SELECT MAX(id) FROM messages WHERE conversation_id = ?) WHERE conversation_id = ? AND user_id = ?').bind(convId, convId, user.id)
  ]);
  const m = msgOut({ ...res.results[0], width: w, height: h });
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'msg', m });
  later(env, pushMessage(env, user, conv, res.results[0]));
  return json(m, 201);
}

async function ownMessage(env, user, id) {
  const m = await env.DB.prepare(`SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = ?`).bind(id).first();
  if (!m || m.sender_id !== user.id || m.deleted_at || m.removed) throw new HttpError(404, 'Bericht niet gevonden');
  return m;
}

async function editMessage(env, user, id, request) {
  const m = await ownMessage(env, user, id);
  if (m.kind !== 'text') throw new HttpError(400, 'Dit bericht kun je niet bewerken');
  if (now() - m.created_at > EDIT_WINDOW) throw new HttpError(400, 'Berichten kun je tot 24 uur na het versturen bewerken');
  const b = await body(request);
  let text;
  let enc = 0;
  if (b.enc) {
    const conv = await memberOf(env, user, m.conversation_id);
    text = checkEnvelope(b.body, conv);
    enc = 1;
  } else {
    text = String(b.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);
    if (!text) return deleteMessage(env, user, id);
  }
  const t = now();
  await env.DB.prepare('UPDATE messages SET body = ?, edited_at = ?, enc = ? WHERE id = ?').bind(text, t, enc, id).run();
  const out = msgOut({ ...m, body: text, edited_at: t, enc });
  await hub(env).notify(await activeMemberIds(env, m.conversation_id), { t: 'msg', m: out });
  return json(out);
}

async function encryptOldMessage(env, user, id, request) {
  const m = await ownMessage(env, user, id);
  if (m.enc || m.kind !== 'text') return json(msgOut(m));
  const conv = await memberOf(env, user, m.conversation_id, false);
  const b = await body(request);
  const text = checkEnvelope(b.body, conv);
  await env.DB.prepare('UPDATE messages SET body = ?, enc = 1 WHERE id = ? AND enc = 0').bind(text, id).run();
  const out = msgOut({ ...m, body: text, enc: 1 });
  await hub(env).notify(await activeMemberIds(env, m.conversation_id), { t: 'msg', m: out });
  return json(out);
}

async function deleteMessage(env, user, id) {
  const m = await ownMessage(env, user, id);
  const t = now();
  await env.DB.prepare("UPDATE messages SET deleted_at = ?, body = '', media_id = NULL WHERE id = ?").bind(t, id).run();
  await dropMedia(env, m.media_id);
  const out = msgOut({ ...m, deleted_at: t });
  await hub(env).notify(await activeMemberIds(env, m.conversation_id), { t: 'msg', m: out });
  return json(out);
}

async function broadcastMessage(env, id) {
  const m = await env.DB.prepare(`SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = ?`).bind(id).first();
  if (m) await hub(env).notify(await activeMemberIds(env, m.conversation_id), { t: 'msg', m: msgOut(m) });
  return m;
}

// Reactie zetten of weghalen (lege body). De emoji zit versleuteld in een envelop.
async function react(env, user, id, request) {
  const m = await env.DB.prepare('SELECT conversation_id, deleted_at, removed, kind FROM messages WHERE id = ?').bind(id).first();
  if (!m || m.deleted_at || m.removed || m.kind === 'system') throw new HttpError(404, 'Bericht niet gevonden');
  const conv = await memberOf(env, user, m.conversation_id);
  const b = await body(request);
  if (!b.body) {
    await env.DB.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').bind(id, user.id).run();
  } else {
    const env_ = checkEnvelope(b.body, conv);
    await env.DB.prepare(
      'INSERT INTO reactions (message_id, user_id, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET body = excluded.body, created_at = excluded.created_at'
    ).bind(id, user.id, env_, now()).run();
  }
  return json(msgOut(await broadcastMessage(env, id)));
}

async function hideMessage(env, user, id) {
  const m = await env.DB.prepare('SELECT conversation_id FROM messages WHERE id = ?').bind(id).first();
  if (!m) throw new HttpError(404, 'Bericht niet gevonden');
  await memberOf(env, user, m.conversation_id, false);
  await env.DB.prepare('INSERT INTO hidden (user_id, message_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(user.id, id).run();
  return json({ ok: true });
}

// Dempen, vastpinnen en archiveren (alleen voor jezelf).
async function myConvSettings(env, user, convId, request) {
  await memberOf(env, user, convId, false);
  const b = await body(request);
  const sets = [];
  const vals = [];
  if ('muted_until' in b) { sets.push('muted_until = ?'); vals.push(Math.max(0, Number(b.muted_until) || 0)); }
  if ('pinned' in b) { sets.push('pinned = ?'); vals.push(b.pinned ? 1 : 0); }
  if ('archived' in b) { sets.push('archived = ?'); vals.push(b.archived ? 1 : 0); }
  if (sets.length) await env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE conversation_id = ? AND user_id = ?`).bind(...vals, convId, user.id).run();
  await hub(env).notify([user.id], { t: 'conv', c: convId });
  return json({ ok: true });
}

// Verdwijnende berichten voor het hele gesprek.
async function setExpire(env, user, convId, request) {
  await memberOf(env, user, convId);
  const b = await body(request);
  const expire = Number(b.expire) || 0;
  if (!EXPIRES.includes(expire)) throw new HttpError(400, 'Ongeldige tijd');
  await env.DB.batch([
    env.DB.prepare('UPDATE conversations SET expire = ?, last_at = ? WHERE id = ?').bind(expire, now(), convId),
    systemMessage(env, convId, user.id, { e: 'expire', s: expire })
  ]);
  await broadcastLatest(env, convId);
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'conv', c: convId });
  return json({ ok: true });
}

// Cron: verlopen berichten en hun bijlagen echt verwijderen, oude pogingen opruimen.
async function cleanupExpired(env) {
  const { results } = await env.DB.prepare('SELECT id, media_id FROM messages WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 500').bind(now()).all();
  if (results.length) {
    await mediaDelete(env, results.map((r) => r.media_id).filter(Boolean));
    const marks = results.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM messages WHERE id IN (${marks})`).bind(...results.map((r) => r.id)).run();
  }
  await env.DB.prepare('DELETE FROM attempts WHERE at < ?').bind(now() - 86400e3).run();
  await env.DB.prepare('DELETE FROM bigfiles WHERE expires_at < ?').bind(now() - 86400e3).run();
}

// Groot bestand: eerst een upload-ticket, daarna (na het uploaden) het bericht met de versleutelde beschrijving.
async function bigTicket(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  await canMessage(env, user, conv);
  const b = await body(request);
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT n FROM usage WHERE key = ?').bind(`big:${user.id}:${day}`).first();
  const ticket = await uploadTicket(env, user, conv, Number(b.size), row?.n || 0);
  await env.DB.prepare('INSERT INTO usage (key, n) VALUES (?, ?) ON CONFLICT DO UPDATE SET n = n + excluded.n').bind(`big:${user.id}:${day}`, Number(b.size)).run();
  return json(ticket);
}

async function sendBig(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  await canMessage(env, user, conv);
  const b = await body(request);
  const file = await env.DB.prepare('SELECT id FROM bigfiles WHERE id = ? AND conversation_id = ? AND owner_id = ?').bind(str(b.file, 40), convId, user.id).first();
  if (!file) throw new HttpError(404, 'Bestand niet gevonden');
  const text = checkEnvelope(b.body, conv);
  const t = now();
  const [res] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO messages (conversation_id, sender_id, kind, body, client_id, created_at, enc, expires_at) VALUES (?, ?, 'photo', ?, ?, ?, 1, ?) RETURNING *"
    ).bind(convId, user.id, text, str(b.client_id, 40) || null, t, conv.expire ? t + conv.expire * 1000 : null),
    env.DB.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(t, convId)
  ]);
  const m = msgOut(res.results[0]);
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'msg', m });
  later(env, pushMessage(env, user, conv, res.results[0]));
  return json(m, 201);
}

// Recente gesprekken (bellen) uit alle gesprekken waar je in zit.
async function listCalls(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.conversation_id AS c, m.sender_id AS u, m.body AS b, m.created_at AS at
       FROM messages m JOIN members x ON x.conversation_id = m.conversation_id AND x.user_id = ?
      WHERE m.kind = 'call' AND m.deleted_at IS NULL
        AND m.id NOT IN (SELECT message_id FROM hidden WHERE user_id = ?)
      ORDER BY m.id DESC LIMIT 100`
  ).bind(user.id, user.id).all();
  return json(results);
}

async function markRead(env, user, convId, request) {
  await memberOf(env, user, convId, false);
  const b = await body(request);
  const upto = Number(b.id) || 0;
  await env.DB.prepare('UPDATE members SET last_read = MAX(last_read, ?) WHERE conversation_id = ? AND user_id = ?').bind(upto, convId, user.id).run();
  if (user.read_receipts) {
    await hub(env).notify(await activeMemberIds(env, convId), { t: 'read', c: convId, u: user.id, id: upto });
  } else {
    await hub(env).notify([user.id], { t: 'read', c: convId, u: user.id, id: upto });
  }
  return json({ ok: true });
}

async function reportMessage(env, user, id, request) {
  const b = await body(request);
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  if (!m || m.deleted_at || m.removed || m.kind === 'system') throw new HttpError(404, 'Bericht niet gevonden');
  if (m.sender_id === user.id) throw new HttpError(400, 'Je kunt je eigen bericht niet melden');
  await memberOf(env, user, m.conversation_id, false);
  const reason = REASONS.includes(b.reason) ? b.reason : 'anders';
  if (await tooManyAttempts(env, `report|${user.id}`, 30, 3600e3)) throw new HttpError(429, 'Te veel meldingen, probeer het later opnieuw');
  let snapshot = m.body;
  let msgKey = null;
  if (m.enc) {
    // Alleen dit ene bericht wordt leesbaar voor de beheerder: de melder geeft de sleutel van dit bericht mee.
    const env_ = parseEnvelope(m.body);
    try {
      msgKey = b64field(b.key, 40, 48, 'sleutel');
      snapshot = new TextDecoder().decode(await openWithKey(msgKey, env_.c));
    } catch {
      throw new HttpError(400, 'Dit bericht kon niet worden gecontroleerd');
    }
  }
  await recordAttempt(env, `report|${user.id}`);
  await env.DB.prepare(
    `INSERT INTO reports (message_id, reporter_id, sender_id, reason, note, snapshot, media_id, msg_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  ).bind(id, user.id, m.sender_id, reason, str(b.note, 500), snapshot, m.media_id, msgKey, now()).run();
  return json({ ok: true }, 201);
}

// ---------- Bellen ----------

async function iceServers(env) {
  const servers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN && await turnAllowed(env)) {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 4 * 3600 })
      });
      if (res.ok) {
        // Alleen de TURN-adressen via UDP en TCP op 3478 en TLS op 443; de rest is dubbel.
        const ice = (await res.json()).iceServers;
        return json(Array.isArray(ice) ? ice : [ice]);
      }
    } catch {}
  }
  return json(servers);
}

// De app meldt hoeveel data een gesprek via TURN ging, zodat we binnen het gratis budget blijven.
async function reportTurn(env, user, request) {
  const b = await body(request);
  const bytes = Math.max(0, Math.min(300 * 1024 ** 2, Math.round(Number(b.bytes) || 0)));
  if (await tooManyAttempts(env, `turn|${user.id}`, 10, 60e3)) return json({ ok: true });
  await recordAttempt(env, `turn|${user.id}`);
  if (bytes) await bump(env, usageKey.turn(), bytes).run();
  return json({ ok: true });
}

// ---------- Beheer ----------

function requireAdmin(user) {
  if (!user.is_admin) throw new HttpError(403, 'Alleen voor de beheerder');
}

async function adminStats(env) {
  const day = now() - 86400e3;
  const [a, b, c, d, e, f, g] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(status = 'blocked') AS blocked FROM users"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM messages'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?').bind(day),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(CASE WHEN in_r2 = 0 THEN size ELSE 0 END), 0) AS d1 FROM media'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM conversations'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').bind(day)
  ]);
  return json({
    users: a.results[0].n, blocked: a.results[0].blocked || 0, new_users: g.results[0].n,
    online: await hub(env).onlineCount(),
    messages: b.results[0].n, messages_today: c.results[0].n, open_reports: d.results[0].n,
    media: e.results[0].n, media_bytes: e.results[0].bytes, media_d1_bytes: e.results[0].d1,
    conversations: f.results[0].n, r2: !!env.MEDIA, usage: await usageReport(env),
    push_subs: (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first()).n,
    turn: !!(env.TURN_KEY_ID && env.TURN_KEY_TOKEN),
    registration: await setting(env, 'registration', 'open'),
    announcement: await setting(env, 'announcement', '')
  });
}

async function adminReports(env, url) {
  const status = ['open', 'goed', 'fout'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'open';
  const { results } = await env.DB.prepare(
    `SELECT r.*, m.kind, m.created_at AS sent_at, m.conversation_id, m.removed, m.deleted_at,
            s.username AS sender_username, s.display_name AS sender_name, s.status AS sender_status, s.warnings AS sender_warnings,
            p.username AS reporter_username, p.display_name AS reporter_name, a.display_name AS resolver_name,
            (SELECT COUNT(*) FROM reports q WHERE q.message_id = r.message_id) AS times
       FROM reports r LEFT JOIN messages m ON m.id = r.message_id
       LEFT JOIN users s ON s.id = r.sender_id LEFT JOIN users p ON p.id = r.reporter_id
       LEFT JOIN users a ON a.id = r.resolved_by
      WHERE r.status = ? ORDER BY r.created_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 200`
  ).bind(status).all();
  return json(results);
}

// Goedkeuren: het bericht mag blijven. Foutkeuren: het bericht wordt verwijderd, met eventueel een
// waarschuwing of blokkade voor de afzender. Andere open meldingen van hetzelfde bericht gaan mee.
async function adminDecide(env, admin, id, request) {
  const b = await body(request);
  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) throw new HttpError(404, 'Melding niet gevonden');
  const decision = b.decision === 'fout' ? 'fout' : 'goed';
  const action = decision === 'fout' && ['waarschuwen', 'blokkeren'].includes(b.action) ? b.action : '';
  const t = now();
  const stmts = [
    env.DB.prepare(
      `UPDATE reports SET status = ?, action = ?, resolved_at = ?, resolved_by = ?
        WHERE (id = ? OR (message_id = ? AND status = 'open'))`
    ).bind(decision, action, t, admin.id, id, report.message_id)
  ];
  let msg = null;
  if (decision === 'fout' && report.message_id) {
    msg = await env.DB.prepare(`SELECT ${MSG_COLS} FROM ${MSG_FROM} WHERE m.id = ?`).bind(report.message_id).first();
    stmts.push(env.DB.prepare("UPDATE messages SET removed = 1, body = '', media_id = NULL WHERE id = ?").bind(report.message_id));
  }
  if (action && report.sender_id) {
    stmts.push(env.DB.prepare('UPDATE users SET warnings = warnings + 1 WHERE id = ?').bind(report.sender_id));
    if (action === 'blokkeren') {
      stmts.push(env.DB.prepare("UPDATE users SET status = 'blocked' WHERE id = ? AND is_admin = 0").bind(report.sender_id));
      stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id IN (SELECT id FROM users WHERE is_admin = 0)').bind(report.sender_id));
    }
  }
  await env.DB.batch(stmts);
  if (msg) {
    await hub(env).notify(await activeMemberIds(env, msg.conversation_id), { t: 'msg', m: msgOut({ ...msg, removed: 1 }) });
  }
  if (action === 'waarschuwen' && report.sender_id) {
    await hub(env).notify([report.sender_id], { t: 'warning', reason: report.reason });
  }
  if (action === 'blokkeren' && report.sender_id) await hub(env).kick(report.sender_id);
  return json({ ok: true });
}

async function adminReportMedia(env, id) {
  const report = await env.DB.prepare('SELECT media_id, msg_key FROM reports WHERE id = ?').bind(id).first();
  const row = report?.media_id && await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(report.media_id).first();
  if (!row) throw new HttpError(404, 'Foto niet meer beschikbaar');
  if (!row.enc) return mediaResponse(env, row, 'no-store');
  // Versleutelde foto: ontsleutelen met de sleutel die de melder meegaf.
  let data = row.data;
  if (row.in_r2) data = await r2Bytes(env, row.id);
  else if (Array.isArray(data)) data = new Uint8Array(data);
  else data = new Uint8Array(data);
  let plain;
  try {
    plain = await openWithKey(report.msg_key, data);
  } catch {
    throw new HttpError(404, 'Foto kon niet worden ontsleuteld');
  }
  return mediaResponse(env, { ...row, in_r2: 0, data: plain, mime: sniffImage(plain) || 'application/octet-stream' }, 'no-store');
}

async function adminUsers(env, url) {
  const q = str(url.searchParams.get('q'), 60).toLowerCase();
  const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.email, u.status, u.is_admin, u.warnings, u.created_at, u.last_seen, u.avatar_id,
            (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) AS messages,
            (SELECT COUNT(*) FROM reports r WHERE r.sender_id = u.id AND r.status = 'fout') AS rejected,
            (SELECT COUNT(*) FROM contacts c WHERE c.user_id = u.id AND c.state = 'ok') AS contacts
       FROM users u
      WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR LOWER(u.display_name) LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'
      ORDER BY u.created_at DESC LIMIT 500`
  ).bind(q, like, like, like).all();
  const states = results.length ? await hub(env).states(results.map((u) => u.id)) : {};
  return json(results.map((u) => ({ ...u, is_admin: !!u.is_admin, online: !!states[u.id]?.conns })));
}

async function adminUpdateUser(env, admin, id, request) {
  const b = await body(request);
  const target = await env.DB.prepare('SELECT id, is_admin FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'Gebruiker niet gevonden');
  if (target.id === admin.id && ('status' in b || 'is_admin' in b)) throw new HttpError(400, 'Dat kun je niet bij je eigen account');
  if ('status' in b) {
    const status = b.status === 'blocked' ? 'blocked' : 'active';
    const stmts = [env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id)];
    if (status === 'blocked') stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    await env.DB.batch(stmts);
    if (status === 'blocked') await hub(env).kick(id);
    await notifyContacts(env, id, { t: 'contacts' });
  }
  if ('is_admin' in b) await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(b.is_admin ? 1 : 0, id).run();
  if ('warnings' in b) await env.DB.prepare('UPDATE users SET warnings = ? WHERE id = ?').bind(Math.max(0, Number(b.warnings) || 0), id).run();
  return json({ ok: true });
}

async function adminResetPassword(env, admin, id) {
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'Gebruiker niet gevonden');
  const temp = randomToken(9).replace(/[-_]/g, 'x');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, kdf_v = 0, kdf_salt = NULL, pubkey = NULL, enc_privkey = NULL WHERE id = ?').bind(await hashPassword(temp), id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)
  ]);
  if (id !== admin.id) await hub(env).kick(id);
  return json({ password: temp });
}

async function adminDeleteUser(env, admin, id) {
  if (id === admin.id) throw new HttpError(400, 'Je kunt je eigen account hier niet verwijderen');
  const { results } = await env.DB.prepare('SELECT id FROM media WHERE owner_id = ?').bind(id).all();
  await hub(env).kick(id);
  if (env.MEDIA && results.length) await env.MEDIA.delete(results.map((r) => `media/${r.id}`));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media WHERE owner_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id)
  ]);
  return json({ ok: true });
}

// Bijlagen ouder dan zoveel maanden verwijderen om ruimte te maken (verwijderen kost niets in R2).
async function adminCleanup(env, request) {
  const b = await body(request);
  const months = Math.max(1, Math.min(60, Number(b.months) || 12));
  const before = now() - months * 30 * 86400e3;
  const { results } = await env.DB.prepare(
    'SELECT id FROM media WHERE conversation_id IS NOT NULL AND created_at < ? AND id NOT IN (SELECT media_id FROM reports WHERE media_id IS NOT NULL) LIMIT 1000'
  ).bind(before).all();
  const ids = results.map((r) => r.id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE messages SET media_id = NULL WHERE media_id IN (${marks})`).bind(...ids).run();
    await mediaDelete(env, ids);
  }
  return json({ removed: ids.length });
}

async function adminSettings(env, request) {
  const b = await body(request);
  const stmts = [];
  const put = (k, v) => stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value').bind(k, v));
  if ('announcement' in b) put('announcement', str(b.announcement, 2000));
  if ('registration' in b) put('registration', b.registration === 'closed' ? 'closed' : 'open');
  if (stmts.length) await env.DB.batch(stmts);
  if ('announcement' in b) {
    const { results } = await env.DB.prepare("SELECT id FROM users WHERE status = 'active'").all();
    await hub(env).notify(results.map((r) => r.id), { t: 'announcement', text: str(b.announcement, 2000) });
  }
  return json({ ok: true });
}

// ---------- Router ----------

async function route(request, env, url) {
  const m = request.method;
  const p = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const [a, b, c, d] = p.split('/');

  if (m !== 'GET' && m !== 'HEAD') {
    // Tegen CSRF: wijzigingen alleen vanaf onze eigen pagina's (of apps zonder Origin-header).
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Verzoek geweigerd');
  }

  if (p === 'register' && m === 'POST') return register(env, request);
  if (p === 'login' && m === 'POST') return login(env, request);
  if (p === 'prelogin' && m === 'POST') return prelogin(env, request);
  if (p === 'logout' && m === 'POST') {
    await destroySession(env, request);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (p === 'config' && m === 'GET') return json({ registration: await setting(env, 'registration', 'open') });

  const user = await sessionUser(env, request);
  if (!user) throw new HttpError(401, 'Niet ingelogd');
  const id = Number(b);

  if (p === 'ws') {
    if (request.headers.get('upgrade') !== 'websocket') throw new HttpError(426, 'WebSocket verwacht');
    const headers = new Headers(request.headers);
    headers.set('x-skitta-user', String(user.id));
    headers.set('x-skitta-dev', str(url.searchParams.get('dev'), 40));
    return hub(env).fetch(new Request('https://hub/ws', { headers }));
  }

  if (a === 'me') {
    if (!b && m === 'GET') return json(meOut(env, user, await setting(env, 'announcement', '')));
    if (!b && m === 'PATCH') return updateMe(env, user, request);
    if (b === 'password' && m === 'POST') return changePassword(env, user, request);
    if (b === 'upgrade' && m === 'POST') return upgradeMe(env, user, request);
    if (b === 'avatar' && m === 'PUT') return setAvatar(env, user, request);
    if (b === 'avatar' && m === 'DELETE') return removeAvatar(env, user);
  }
  if (a === 'media' && b && m === 'GET') return getMedia(env, user, b);
  if (a === 'ice' && m === 'GET') return iceServers(env);
  if (p === 'usage/turn' && m === 'POST') return reportTurn(env, user, request);
  if (p === 'push/key' && m === 'GET') return json({ key: await vapidPublicKey(env) });
  if (a === 'big' && b && m === 'GET') return json(await downloadTicket(env, user, b));
  if (p === 'push' && m === 'POST') return pushSubscribe(env, user, request);
  if (p === 'push' && m === 'DELETE') return pushUnsubscribe(env, user, request);
  if (a === 'keys' && m === 'GET') return listKeys(env, user, url);
  if (a === 'calls' && m === 'GET') return listCalls(env, user);
  if (p === 'gif/search' && m === 'GET') return gifSearch(env, url, env.ctx);
  if (p === 'gif/media' && m === 'GET') return gifMedia(url);

  if (a === 'users' && b === 'search' && m === 'GET') return searchUsers(env, user, url);

  if (a === 'contacts') {
    if (!b && m === 'GET') return listContacts(env, user);
    if (!b && m === 'POST') return addContact(env, user, request);
    if (id && c === 'accept' && m === 'POST') return acceptContact(env, user, id);
    if (id && c === 'block' && m === 'POST') return blockContact(env, user, id, true);
    if (id && c === 'block' && m === 'DELETE') return blockContact(env, user, id, false);
    if (id && !c && m === 'DELETE') return removeContact(env, user, id);
  }

  if (a === 'conversations') {
    if (!b && m === 'GET') return listConversations(env, user);
    if (!b && m === 'POST') return createConversation(env, user, request);
    if (id && !c && m === 'PATCH') return updateConversation(env, user, id, request);
    if (id && c === 'messages' && m === 'GET') return listMessages(env, user, id, url);
    if (id && c === 'messages' && m === 'POST') return sendMessage(env, user, id, request);
    if (id && c === 'photo' && m === 'POST') return sendPhoto(env, user, id, request, url);
    if (id && c === 'read' && m === 'POST') return markRead(env, user, id, request);
    if (id && c === 'keys' && m === 'POST') return putKeys(env, user, id, request);
    if (id && c === 'me' && m === 'PATCH') return myConvSettings(env, user, id, request);
    if (id && c === 'big' && m === 'POST') return bigTicket(env, user, id, request);
    if (id && c === 'bigmsg' && m === 'POST') return sendBig(env, user, id, request);
    if (id && c === 'expire' && m === 'PATCH') return setExpire(env, user, id, request);
    if (id && c === 'members' && !d && m === 'POST') return addMembers(env, user, id, request);
    if (id && c === 'members' && d === 'me' && m === 'DELETE') return leaveConversation(env, user, id);
  }

  if (a === 'messages' && id) {
    if (!c && m === 'PATCH') return editMessage(env, user, id, request);
    if (!c && m === 'DELETE') return deleteMessage(env, user, id);
    if (c === 'report' && m === 'POST') return reportMessage(env, user, id, request);
    if (c === 'encrypt' && m === 'PUT') return encryptOldMessage(env, user, id, request);
    if (c === 'reaction' && m === 'PUT') return react(env, user, id, request);
    if (c === 'hide' && m === 'POST') return hideMessage(env, user, id);
  }

  if (a === 'admin') {
    requireAdmin(user);
    if (b === 'stats' && m === 'GET') return adminStats(env);
    if (b === 'settings' && m === 'POST') return adminSettings(env, request);
    if (b === 'cleanup' && m === 'POST') return adminCleanup(env, request);
    if (b === 'reports' && !c && m === 'GET') return adminReports(env, url);
    if (b === 'reports' && c && !d && m === 'POST') return adminDecide(env, user, Number(c), request);
    if (b === 'reports' && c && d === 'media' && m === 'GET') return adminReportMedia(env, Number(c));
    if (b === 'users' && !c && m === 'GET') return adminUsers(env, url);
    if (b === 'users' && c && !d && m === 'PATCH') return adminUpdateUser(env, user, Number(c), request);
    if (b === 'users' && c && !d && m === 'DELETE') return adminDeleteUser(env, user, Number(c));
    if (b === 'users' && c && d === 'reset-password' && m === 'POST') return adminResetPassword(env, user, Number(c));
  }

  throw new HttpError(404, 'Niet gevonden');
}

export default {
  async fetch(request, rawEnv, ctx) {
    // ctx meegeven zodat pushmeldingen en tellers na het antwoord kunnen afronden.
    const env = Object.create(rawEnv);
    env.ctx = ctx;
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !env.DEV) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: 'Er ging iets mis op de server' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  }
};
