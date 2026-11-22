// Skitta Lite: lichte accounts voor oude of trage telefoons (zoals een Lumia 435). Geen sleutels en geen
// versleuteling, dus inloggen is meteen klaar. Lite-gebruikers chatten met elkaar én met gewone Skitta-gebruikers;
// zo'n gesprek is niet end-to-end versleuteld (de Skitta-app laat dat zien en verstuurt daar onversleuteld).
// De webapp staat in public/lite/ en draait op skittalite.timvanbergen.nl (en op belliechat.timvanbergen.nl,
// waar de oude Belliechat-app op de Lumia nog naartoe gaat). Verder gebruikt hij de gewone API
// (berichten, gelezen, /api/media, /api/ws).
import { HttpError, json, now, hashPassword, verifyPassword, createSession, tooManyAttempts, recordAttempt, clientIp, randomToken } from './util.js';
import {
  body, str, setting, hub, later, conversationsFor, contactRow, makeContacts, directConversation, memberOf, canMessage,
  activeMemberIds, mediaInsert, mediaStore, sniffImage, msgOut, pushMessage, ownMessage, dropMedia
} from './worker.js';

const NAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;

// Edge 14 rekent wss: niet tot 'self', dus het adres staat er los bij.
export const liteCsp = (host) => "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  `media-src 'self' blob:; connect-src 'self' wss://${host}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

// Grenzen voor onversleutelde bijlagen. De totalen van Skitta (src/limits.js) gelden daarbovenop.
const PHOTO_MAX = 4 * 1024 ** 2;
const FILE_MAX = 25 * 1024 ** 2;
const LITE_DAILY = 200 * 1024 ** 2;
const KINDS = ['photo', 'video', 'voice', 'file', 'gif', 'sticker'];

function liteUser(u) {
  return { id: u.id, name: u.display_name, username: u.username };
}

// Net als Belliechat: een token (geen cookie), want cookies werken niet goed in de Lumia-app.
async function session(env, user, status = 200) {
  const token = randomToken(32);
  await createSession(env, user.id, true, token);
  return json({ ok: true, token, user: liteUser(user) }, status);
}

export async function liteRegister(env, request) {
  if ((await setting(env, 'registration', 'open')) !== 'open') throw new HttpError(403, 'Nieuwe accounts maken is op dit moment uitgeschakeld');
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `reg|${ip}`, 5, 3600e3)) throw new HttpError(429, 'Te veel pogingen, probeer het later opnieuw');
  const b = await body(request);
  const display = str(b.name, 32);
  const username = display.toLowerCase();
  if (!NAME_RE.test(username)) throw new HttpError(400, 'Kies een naam van 3 tot 32 tekens die met een letter begint (letters, cijfers, . _ -)');
  const pass = String(b.pass ?? '');
  if (pass.length < 6 || pass.length > 200) throw new HttpError(400, 'Kies een wachtwoord van minstens 6 tekens');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) throw new HttpError(409, 'Die naam is al bezet (ook namen van Skitta tellen mee)');
  await recordAttempt(env, `reg|${ip}`);
  // kdf_v 2 = Lite: nooit het "oud account omzetten" van de gewone login. Het e-mailadres is alleen een unieke opvulling.
  const user = await env.DB.prepare(
    `INSERT INTO users (username, display_name, email, password_hash, kdf_v, lite, created_at)
     VALUES (?, ?, ?, ?, 2, 1, ?) RETURNING id, username, display_name`
  ).bind(username, display, `${username}.${randomToken(6)}@lite.invalid`, await hashPassword(pass), now()).first();
  return session(env, user, 201);
}

export async function liteLogin(env, request) {
  const b = await body(request);
  const username = str(b.name, 32).toLowerCase();
  const ip = clientIp(request);
  if (await tooManyAttempts(env, `login|${ip}`, 20, 900e3) || await tooManyAttempts(env, `login|${username}`, 10, 900e3)) {
    throw new HttpError(429, 'Te veel mislukte pogingen. Wacht een kwartier en probeer het opnieuw.');
  }
  const user = await env.DB.prepare('SELECT id, username, display_name, password_hash, status, lite FROM users WHERE username = ?').bind(username).first();
  if (user && !user.lite) throw new HttpError(403, 'Dit is een gewoon Skitta-account. Log in op skitta.timvanbergen.nl, of maak hier een Lite-account.');
  if (!user || !(await verifyPassword(String(b.pass ?? ''), user.password_hash))) {
    await recordAttempt(env, `login|${ip}`);
    await recordAttempt(env, `login|${username}`);
    throw new HttpError(401, 'Naam of wachtwoord klopt niet');
  }
  if (user.status !== 'active') throw new HttpError(403, 'Dit account is geblokkeerd door de beheerder');
  return session(env, user);
}

// De chats van een Lite-gebruiker: alleen gesprekken met één persoon.
export async function liteChats(env, user) {
  const convs = await conversationsFor(env, user);
  return json({ me: liteUser(user), chats: convs.filter((c) => c.kind === 'direct' && !c.left).map((c) => chatOut(c, user)) });
}

function chatOut(c, user) {
  const o = c.members.find((m) => m.id !== user.id) || {};
  return {
    id: c.id, at: c.last_at, unread: c.unread,
    user: { id: o.id, name: o.display_name, username: o.username, lite: !!o.lite },
    last: c.last && c.last.k !== 'system' ? c.last : null
  };
}

// Chat beginnen. Met een Lite-gebruiker meteen; met een Skitta-gebruiker eerst een contactverzoek
// (tenzij die jou al had toegevoegd), net als in Skitta zelf.
export async function liteStart(env, user, request) {
  const b = await body(request);
  const other = await env.DB.prepare("SELECT id, display_name, lite FROM users WHERE id = ? AND status = 'active'").bind(Number(b.user) || 0).first();
  if (!other || other.id === user.id) throw new HttpError(404, 'Die persoon bestaat niet');
  const mine = await contactRow(env, user.id, other.id);
  const theirs = await contactRow(env, other.id, user.id);
  if (mine?.state === 'blocked') throw new HttpError(403, 'Je hebt deze persoon geblokkeerd');
  if (mine?.state !== 'ok') {
    if (theirs?.state === 'blocked') return json({ pending: true, name: other.display_name });
    if (other.lite || mine?.state === 'in') {
      await makeContacts(env, user.id, other.id);
    } else {
      if (await tooManyAttempts(env, `contact|${user.id}`, 30, 3600e3)) throw new HttpError(429, 'Te veel verzoeken, probeer het later opnieuw');
      await recordAttempt(env, `contact|${user.id}`);
      const t = now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO contacts (user_id, contact_id, state, created_at) VALUES (?, ?, 'out', ?) ON CONFLICT DO UPDATE SET state = 'out', created_at = excluded.created_at"
        ).bind(user.id, other.id, t),
        env.DB.prepare(
          "INSERT INTO contacts (user_id, contact_id, state, message, created_at) VALUES (?, ?, 'in', ?, ?) ON CONFLICT DO UPDATE SET state = 'in', message = excluded.message, created_at = excluded.created_at"
        ).bind(other.id, user.id, 'Hoi! Ik gebruik Skitta Lite en wil graag met je chatten. (Chats met Skitta Lite zijn niet versleuteld.)', t)
      ]);
      await hub(env).notify([other.id], { t: 'contacts', request: user.id });
      return json({ pending: true, name: other.display_name });
    }
  }
  const conv = await directConversation(env, user.id, other.id);
  const [c] = await conversationsFor(env, user, conv.id);
  return json({ chat: chatOut(c, user) });
}

// Een gesprek met een Lite-gebruiker? Daar heeft versleutelen geen zin: Skitta Lite kan het niet lezen.
export async function liteConv(env, conv) {
  return conv.kind === 'direct' && !!(await env.DB.prepare(
    'SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND u.lite = 1'
  ).bind(conv.id).first());
}

// Een oude Skitta-versie (nog open van vóór Skitta Lite) versleutelt alles; zulke berichten weigeren, anders
// staat er bij de ander alleen "versleuteld bericht".
export async function noEncForLite(env, conv) {
  if (await liteConv(env, conv)) {
    throw new HttpError(409, 'Dit gesprek is met iemand op Skitta Lite en wordt niet versleuteld. Sluit Skitta helemaal af en open het opnieuw, dan krijg je de nieuwste versie.');
  }
}

// Bijlage uit een formulier (file, meta, w, h, cid) lezen en controleren.
async function readPlainForm(request) {
  if (Number(request.headers.get('content-length') || 0) > FILE_MAX + 100_000) throw new HttpError(413, 'Bijlagen mogen maximaal 25 MB zijn');
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) throw new HttpError(400, 'Geen bestand ontvangen');
  let meta = {};
  try { meta = JSON.parse(String(form.get('meta') || '{}')); } catch {}
  const t = KINDS.includes(meta.t) ? meta.t : 'file';
  const mime = str(file.type, 100).toLowerCase() || 'application/octet-stream';
  const buf = new Uint8Array(await file.arrayBuffer());
  if (t === 'photo' || t === 'gif' || t === 'sticker') {
    if (buf.length > PHOTO_MAX) throw new HttpError(413, 'Deze foto is te groot');
    if (!sniffImage(buf)) throw new HttpError(415, 'Alleen JPEG-, PNG-, GIF- of WebP-afbeeldingen');
  } else if (t === 'video' && !mime.startsWith('video/')) {
    throw new HttpError(415, 'Dit is geen video');
  }
  const out = { t, name: str(meta.name || file.name, 200), size: buf.length, mime };
  if (Number(meta.dur) > 0) out.dur = Math.min(86400, Math.round(Number(meta.dur)));
  if (typeof meta.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(meta.thumb) && meta.thumb.length < 60_000) out.thumb = meta.thumb;
  if (meta.cap) out.cap = str(meta.cap, 1000);
  return {
    img: { buf, mime }, body: JSON.stringify(out),
    w: Math.min(20000, Number(form.get('w')) || 0), h: Math.min(20000, Number(form.get('h')) || 0),
    cid: str(form.get('cid'), 40) || null
  };
}

// Onversleutelde bijlage (foto, video, …) in een gesprek met een Lite-gebruiker. Zowel Skitta Lite als de
// gewone Skitta-app gebruiken dit; versleutelde gesprekken blijven /photo gebruiken.
export async function sendPlainFile(env, user, convId, request) {
  const conv = await memberOf(env, user, convId);
  await canMessage(env, user, conv);
  if (!(await liteConv(env, conv))) throw new HttpError(400, 'Dit gesprek is versleuteld');
  if (await tooManyAttempts(env, `photo|${user.id}`, 60, 3600e3)) throw new HttpError(429, 'Je stuurt te veel bijlagen, probeer het later opnieuw');
  const { img, body: meta, w, h, cid } = await readPlainForm(request);

  await recordAttempt(env, `photo|${user.id}`);
  const id = randomToken(18);
  await mediaStore(env, user.id, id, img, { fileBytes: FILE_MAX, dailyBytes: LITE_DAILY });
  const at = now();
  const [, res] = await env.DB.batch([
    mediaInsert(env, id, user.id, convId, img, w, h),
    env.DB.prepare(
      "INSERT INTO messages (conversation_id, sender_id, kind, body, media_id, client_id, created_at, enc, expires_at) VALUES (?, ?, 'photo', ?, ?, ?, ?, 0, ?) RETURNING *"
    ).bind(convId, user.id, meta, id, cid, at, conv.expire ? at + conv.expire * 1000 : null),
    env.DB.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').bind(at, convId),
    env.DB.prepare('UPDATE members SET last_read = (SELECT MAX(id) FROM messages WHERE conversation_id = ?) WHERE conversation_id = ? AND user_id = ?').bind(convId, convId, user.id)
  ]);
  const m = msgOut({ ...res.results[0], width: w, height: h });
  await hub(env).notify(await activeMemberIds(env, convId), { t: 'msg', m });
  later(env, pushMessage(env, user, conv, res.results[0]));
  return json(m, 201);
}

// Eigen bericht dat toch versleuteld naar iemand op Skitta Lite ging (oude versie): de afzender zet het om
// naar leesbaar, op dezelfde plek in het gesprek. Tekst als JSON { body }, een bijlage als formulier (zie boven).
export async function unsealMessage(env, user, id, request) {
  const m = await ownMessage(env, user, id);
  if (!m.enc) return json(msgOut(m));
  const conv = await memberOf(env, user, m.conversation_id, false);
  if (!(await liteConv(env, conv))) throw new HttpError(400, 'Dit gesprek is versleuteld');
  if (m.kind === 'text') {
    const text = String((await body(request)).body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
    if (!text) throw new HttpError(400, 'Leeg bericht');
    await env.DB.prepare('UPDATE messages SET body = ?, enc = 0 WHERE id = ? AND enc = 1').bind(text, id).run();
  } else if (m.kind === 'photo') {
    if (await tooManyAttempts(env, `photo|${user.id}`, 60, 3600e3)) throw new HttpError(429, 'Je stuurt te veel bijlagen, probeer het later opnieuw');
    const { img, body: meta, w, h } = await readPlainForm(request);
    await recordAttempt(env, `photo|${user.id}`);
    const mid = randomToken(18);
    await mediaStore(env, user.id, mid, img, { fileBytes: FILE_MAX, dailyBytes: LITE_DAILY });
    await env.DB.batch([
      mediaInsert(env, mid, user.id, m.conversation_id, img, w, h),
      env.DB.prepare('UPDATE messages SET body = ?, media_id = ?, enc = 0 WHERE id = ? AND enc = 1').bind(meta, mid, id)
    ]);
    await dropMedia(env, m.media_id);
  } else {
    throw new HttpError(400, 'Dit bericht kun je niet omzetten');
  }
  const out = msgOut(await ownMessage(env, user, id));
  await hub(env).notify(await activeMemberIds(env, m.conversation_id), { t: 'msg', m: out });
  return json(out);
}
