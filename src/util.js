// Gedeelde hulpfuncties: responses, hashing, sessies en rate limiting (zelfde als in Notities).
// Sessies werken met een cookie (website) of met "Authorization: Bearer <token>" (latere desktop- en Android-app).

const enc = new TextEncoder();

export const now = () => Date.now();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export function fail(status, message) {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// PBKDF2-SHA256; 100.000 iteraties is het maximum dat Workers toestaat.
const PBKDF2_ITER = 100000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const test = await pbkdf2(password, fromB64url(salt), Number(iter));
  return timingSafeEqual(test, fromB64url(hash));
}

// ---------- Sessies ----------

const SESSION_COOKIE = 'sid';

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function createSession(env, userId, remember, token = randomToken(32)) {
  const ttl = remember ? 365 * 86400e3 : 86400e3;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(token), userId, now() + ttl, now())
    .run();
  const maxAge = remember ? `; Max-Age=${365 * 86400}` : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function sessionToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return getCookie(request, SESSION_COOKIE);
}

export async function destroySession(env, request) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
}

export async function sessionUser(env, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const user = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.email, u.mood, u.presence, u.avatar_id, u.is_admin, u.status, u.kdf_v, u.kdf_salt, u.pubkey, u.enc_privkey, u.read_receipts
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`
  ).bind(await sha256hex(token), now()).first();
  return user || null;
}

// ---------- Rate limiting ----------

export async function tooManyAttempts(env, key, limit, windowMs) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?')
    .bind(key, now() - windowMs).first();
  return row.n >= limit;
}

export async function recordAttempt(env, key) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now()),
    env.DB.prepare('DELETE FROM attempts WHERE at < ?').bind(now() - 86400e3)
  ]);
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}
