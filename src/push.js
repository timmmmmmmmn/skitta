// Web Push (RFC 8291 + VAPID) met alleen Web Crypto. Werkt voor de beginscherm-app op iPhone,
// Chrome op Android en desktopbrowsers. Gratis: de pushdiensten van Apple, Google en Mozilla rekenen niets.
// De VAPID-sleutel wordt de eerste keer gemaakt en in de tabel settings bewaard.

const enc = new TextEncoder();

function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = {
    jwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
    pub: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  };
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT DO NOTHING").bind(JSON.stringify(keys)).run();
  return JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid'").first()).value);
}

export async function vapidPublicKey(env) {
  return (await vapidKeys(env)).pub;
}

async function vapidHeader(env, endpoint) {
  const keys = await vapidKeys(env);
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://skitta.timvanbergen.nl'
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.pub}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Inhoud versleutelen voor één abonnement (aes128gcm).
async function encryptPayload(sub, payload) {
  const uaPub = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const peer = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(JSON.stringify(payload)), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// Stuur een melding naar alle apparaten van deze gebruikers. Verlopen abonnementen worden opgeruimd.
export async function pushTo(env, userIds, payload, { ttl = 86400, urgency = 'high' } = {}) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const { results } = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  await Promise.all(results.map(async (sub) => {
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidHeader(env, sub.endpoint),
          'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
          ttl: String(ttl), urgency, ...(payload.tag ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {})
        },
        body: await encryptPayload(sub, payload)
      });
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
      }
    } catch (e) {
      console.error('push', e);
    }
  }));
}
