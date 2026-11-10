// Skitta: de webapp. Geen build-stap; alles in dit bestand. Onderdelen:
// hulpfuncties, geluiden, aanmelden, live verbinding, contactpersonen, gesprekken, berichten,
// dialoogvensters, bellen (WebRTC) en de menubalk.
'use strict';

// ---------- Hulpfuncties ----------

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, data, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (data instanceof Blob) {
    init.body = data;
    init.headers['content-type'] = data.type || 'application/octet-stream';
  } else if (data !== undefined) {
    init.body = JSON.stringify(data);
    init.headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch('/api/' + path, init);
  } catch {
    throw new ApiError(0, 'Geen verbinding met Skitta');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet && S.me) return signedOut();
    throw new ApiError(res.status, out.error || 'Er ging iets mis');
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const time = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (t) => new Date(t).toDateString();
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Vandaag';
  if (d.toDateString() === y.toDateString()) return 'Gisteren';
  const s = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? s : `${s} ${d.getFullYear()}`;
}

function shortWhen(t) {
  if (!t) return '';
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString()) return time(t);
  const days = (Date.now() - t) / 86400e3;
  if (days < 6) return DAYS[d.getDay()].slice(0, 2);
  return `${d.getDate()}-${d.getMonth() + 1}`;
}

function ago(t) {
  if (!t) return '';
  const min = Math.round((Date.now() - t) / 60e3);
  if (min < 2) return 'zojuist';
  if (min < 60) return `${min} minuten geleden`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} uur geleden`;
  const d = Math.round(hr / 24);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
}

function duration(s) {
  const m = Math.floor(s / 60);
  const hh = Math.floor(m / 60);
  return hh ? `${hh}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function store(key, fallback) {
  try {
    const v = localStorage.getItem('skitta.' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem('skitta.' + key, JSON.stringify(value)); } catch {}
}

const ICONS = {
  phone: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z',
  video: 'M17 10.5V7c0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.6 0 1-.4 1-1v-3.5l4 4v-11z',
  hangup: 'M12 9c-1.6 0-3.1.3-4.6.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.7 1.8-.2.2-.4.3-.7.3s-.5-.1-.7-.3L.3 13.1c-.2-.2-.3-.4-.3-.7s.1-.5.3-.7C3.3 8.8 7.4 7 12 7s8.7 1.8 11.7 4.7c.2.2.3.4.3.7s-.1.5-.3.7l-2.5 2.5c-.2.2-.4.3-.7.3s-.5-.1-.7-.3c-.8-.7-1.7-1.3-2.7-1.8-.3-.2-.6-.5-.6-.9V9.7C15.1 9.2 13.6 9 12 9z',
  mic: 'M12 14c1.7 0 3-1.3 3-3V5c0-1.7-1.3-3-3-3S9 3.3 9 5v6c0 1.7 1.3 3 3 3zm5.3-3c0 3-2.5 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.4 2.7 6.2 6 6.7V21h2v-3.3c3.3-.5 6-3.3 6-6.7z',
  micoff: 'M19 11h-1.7c0 .7-.2 1.4-.4 2l1.2 1.2c.6-.9.9-2 .9-3.2zm-4 .2V5c0-1.7-1.3-3-3-3S9 3.3 9 5v.2zM4.3 3L3 4.3l6 6V11c0 1.7 1.3 3 3 3 .2 0 .4 0 .7-.1l1.7 1.7c-.7.3-1.5.5-2.3.5-2.8 0-5.3-2.1-5.3-5.1H5c0 3.4 2.7 6.2 6 6.7V21h2v-3.3c.9-.1 1.8-.4 2.5-.9l4.2 4.2L21 19.7z',
  videooff: 'M21 6.5l-4 4V7c0-.6-.4-1-1-1H9.8L21 17.2zM3.3 2L2 3.3 4.7 6H4c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h12c.2 0 .4-.1.5-.2l3.2 3.2 1.3-1.3z',
  full: 'M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z',
  smile: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-3.5 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12 18c-2.6 0-4.8-1.6-5.7-4h11.4c-.9 2.4-3.1 4-5.7 4z',
  photo: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  pencil: 'M3 17.2V21h3.8L17.8 9.9l-3.8-3.7zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.7 3.8z',
  flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  quote: 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z',
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  user: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  clip: 'M16.5 6v11.5a4 4 0 01-8 0V5a2.5 2.5 0 015 0v10.5a1 1 0 01-2 0V6H10v9.5a2.5 2.5 0 005 0V5a4 4 0 00-8 0v12.5a5.5 5.5 0 0011 0V6z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z',
  bell: 'M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11c0-3.1-1.6-5.6-4.5-6.3V4a1.5 1.5 0 00-3 0v.7C7.6 5.4 6 7.9 6 11v5l-2 2v1h16v-1z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  more: 'M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z',
  screen: 'M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2zM4 6h16v10H4zm8 1l-4 4h3v4h2v-4h3z',
  send: 'M2 21l21-9L2 3v7l15 2-15 2z',
  menu: 'M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z',
  play: 'M8 5v14l11-7z',
  left: 'M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  right: 'M8.6 16.6L10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  download: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z',
  close: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  block: 'M12 2a10 10 0 100 20 10 10 0 000-20zM4 12c0-4.4 3.6-8 8-8 1.8 0 3.5.6 4.9 1.7L5.7 16.9A7.9 7.9 0 014 12zm8 8c-1.8 0-3.5-.6-4.9-1.7L18.3 7.1A7.9 7.9 0 0120 12c0 4.4-3.6 8-8 8z'
};

const svg = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
};

// ---------- Emoticons (de klassieke codes, getoond als emoji) ----------

const EMOTICONS = [
  [':)', '🙂'], [':D', '😃'], [';)', '😉'], [':(', '🙁'], [';(', '😢'], [':P', '😛'], [':O', '😮'], [':|', '😐'],
  ['8-)', '😎'], [':*', '😘'], [':S', '😟'], [':$', '😊'], ['(inlove)', '😍'], ['(rofl)', '🤣'], ['(giggle)', '🤭'],
  ['(sweat)', '😅'], ['(wasntme)', '🙄'], ['(think)', '🤔'], ['|-)', '😴'], ['(yawn)', '🥱'], ['(puke)', '🤮'],
  ['(doh)', '🤦'], ['(angry)', '😠'], ['(devil)', '😈'], ['(angel)', '😇'], ['(party)', '🥳'], ['(nerd)', '🤓'],
  ['(mm)', '🤤'], ['(smirk)', '😏'], ['(hug)', '🤗'], ['(wave)', '👋'], ['(clap)', '👏'], ['(y)', '👍'], ['(n)', '👎'],
  ['(handshake)', '🤝'], ['(punch)', '👊'], ['(muscle)', '💪'], ['(bow)', '🙇'], ['(dance)', '💃'], ['(ninja)', '🥷'],
  ['(h)', '❤️'], ['(u)', '💔'], ['(f)', '🌹'], ['(*)', '⭐'], ['(sun)', '☀️'], ['(rain)', '🌧️'], ['(music)', '🎵'],
  ['(coffee)', '☕'], ['(beer)', '🍺'], ['(d)', '🍹'], ['(pizza)', '🍕'], ['(cake)', '🎂'], ['(gift)', '🎁'],
  ['(cash)', '💰'], ['(call)', '📞'], ['(mp)', '📱'], ['(e)', '✉️'], ['(o)', '🕒'], ['(~)', '🎬'], ['(cat)', '🐱'],
  ['(dog)', '🐶'], ['(snail)', '🐌'], ['(bug)', '🐛'], ['(fire)', '🔥'], ['(skitta)', '💙']
];
const EMO_RE = new RegExp(
  '(^|\\s)(' + EMOTICONS.map(([c]) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=\\s|$|[.,!?])', 'gi'
);
const EMO_MAP = new Map(EMOTICONS.map(([c, e]) => [c.toLowerCase(), e]));
const EMOJI_RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;

// Tekst veilig opbouwen: links, citaten en emoticons, nooit innerHTML met gebruikerstekst.
function richText(text) {
  const frag = document.createDocumentFragment();
  let rest = text;
  const q = /^> (.+?): (.*)\n/.exec(rest);
  if (q) {
    frag.append(h('span', { class: 'quote' }, h('b', null, q[1]), ': ', q[2]));
    rest = rest.slice(q[0].length);
  }
  const withEmo = rest.replace(EMO_RE, (m, pre, code) => pre + (EMO_MAP.get(code.toLowerCase()) || code));
  const parts = withEmo.split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g);
  parts.forEach((part, i) => {
    if (i % 2) {
      frag.append(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part));
      return;
    }
    for (const [j, bit] of part.split(EMOJI_RE).entries()) {
      if (!bit) continue;
      frag.append(j % 2 ? h('span', { class: 'emo' }, bit) : bit);
    }
  });
  return frag;
}

const onlyEmoji = (text) => {
  const t = text.replace(EMO_RE, (m, pre, code) => pre + (EMO_MAP.get(code.toLowerCase()) || code)).trim();
  return t.length > 0 && t.length <= 12 && t.replace(EMOJI_RE, '').trim() === '';
};

// ---------- End-to-end-versleuteling ----------
// Uit het wachtwoord komen (PBKDF2, 600.000 rondes) twee helften: de inlogcode voor de server en de
// sleutel die het geheime deel van je sleutelpaar (ECDH P-256) opent. Dat sleutelpaar is per account,
// zodat je op elk apparaat met alleen je wachtwoord alles kunt lezen.
// Elk gesprek heeft een gesprekssleutel (AES-256, met versies), per lid ingepakt met diens publieke
// sleutel. Elk bericht heeft een eigen berichtsleutel, ingepakt met de gesprekssleutel; bij een melding
// geeft de melder alleen die berichtsleutel mee.

const enc8 = (s) => new TextEncoder().encode(s);
const dec8 = (b) => new TextDecoder().decode(b);
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const CHUNK = 4 * 1024 * 1024;

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => crypto.subtle;

async function sealBytes(key, bytes) {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function openBytes(key, bytes) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

const seal = async (key, bytes) => b64(await sealBytes(key, bytes));
const open = (key, s) => openBytes(key, unb64(s));
const aesKey = (raw, usages = ['encrypt', 'decrypt']) => subtle().importKey('raw', raw, 'AES-GCM', false, usages);

// Het geheime deel van het sleutelpaar wordt in IndexedDB bewaard als niet-exporteerbare CryptoKey.
const KeyStore = {
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open('skitta', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  get(id) { return this.run('readonly', (s) => s.get(`u${id}`)).catch(() => null); },
  put(id, v) { return this.run('readwrite', (s) => s.put(v, `u${id}`)).catch(() => {}); },
  del(id) { return this.run('readwrite', (s) => s.delete(`u${id}`)).catch(() => {}); }
};

const E2E = {
  ITER: 600000,
  priv: null,
  pub: null,
  keys: new Map(),
  media: new Map(),
  filling: new Set(),

  async derive(password, salt) {
    const base = await subtle().importKey('raw', enc8(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: this.ITER }, base, 512));
    return { auth: b64(bits.subarray(0, 32)), wrapKey: await aesKey(bits.slice(32)) };
  },

  // Nieuw sleutelpaar, het geheime deel ingepakt met de sleutel uit het wachtwoord.
  async fresh(password) {
    const salt = b64(rand(16));
    const { auth, wrapKey } = await this.derive(password, salt);
    const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey));
    return {
      fields: { auth, salt, pubkey: b64(new Uint8Array(await subtle().exportKey('raw', kp.publicKey))), enc_privkey: await seal(wrapKey, pkcs8) },
      pkcs8
    };
  },

  async remember(userId, pkcs8, pub) {
    this.priv = await subtle().importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    this.pub = pub;
    await KeyStore.put(userId, { priv: this.priv, pub });
  },

  async forget(userId) {
    this.priv = null;
    this.pub = null;
    this.keys.clear();
    for (const url of this.media.values()) url.then?.((u) => u && URL.revokeObjectURL(u));
    this.media.clear();
    if (userId) await KeyStore.del(userId);
  },

  // Inloggen: de server krijgt alleen de inlogcode. Oude accounts sturen één keer het wachtwoord mee
  // en krijgen dan meteen een inlogcode en sleutelpaar.
  async login(login, password, extra) {
    const pre = await api('POST', 'prelogin', { login });
    if (pre.v === 0) {
      const f = await this.fresh(password);
      const r = await api('POST', 'login', { login, password, upgrade: f.fields, ...extra });
      await this.remember(r.id, f.pkcs8, f.fields.pubkey);
      return r;
    }
    const { auth, wrapKey } = await this.derive(password, pre.salt);
    const r = await api('POST', 'login', { login, auth, ...extra });
    const me = await api('GET', 'me', undefined, { quiet: true });
    await this.remember(r.id, await open(wrapKey, me.enc_privkey), me.pubkey);
    return r;
  },

  async register(data, password) {
    const f = await this.fresh(password);
    const r = await api('POST', 'register', { ...data, ...f.fields });
    await this.remember(r.id, f.pkcs8, f.fields.pubkey);
    return r;
  },

  // Bij het openen van de app: sleutel van dit apparaat laden, of om het wachtwoord vragen.
  async unlock(me) {
    if (me.kdf_v === 1 && me.pubkey) {
      const stored = await KeyStore.get(me.id);
      if (stored?.priv && stored.pub === me.pubkey) {
        this.priv = stored.priv;
        this.pub = stored.pub;
        return true;
      }
    }
    return unlockDialog(me);
  },

  async unlockWith(me, password) {
    if (me.kdf_v === 0 || !me.pubkey) {
      const f = await this.fresh(password);
      await api('POST', 'me/upgrade', { password, upgrade: f.fields });
      await this.remember(me.id, f.pkcs8, f.fields.pubkey);
      Object.assign(me, { kdf_v: 1, kdf_salt: f.fields.salt, pubkey: f.fields.pubkey, enc_privkey: f.fields.enc_privkey });
      return;
    }
    const { wrapKey } = await this.derive(password, me.kdf_salt);
    let pkcs8;
    try {
      pkcs8 = await open(wrapKey, me.enc_privkey);
    } catch {
      throw new Error('Wachtwoord klopt niet');
    }
    await this.remember(me.id, pkcs8, me.pubkey);
  },

  async changePassword(me, current, next) {
    const { auth: currentAuth, wrapKey } = await this.derive(current, me.kdf_salt);
    let pkcs8;
    try {
      pkcs8 = await open(wrapKey, me.enc_privkey);
    } catch {
      throw new Error('Huidig wachtwoord klopt niet');
    }
    const salt = b64(rand(16));
    const n = await this.derive(next, salt);
    const fields = { current_auth: currentAuth, auth: n.auth, salt, enc_privkey: await seal(n.wrapKey, pkcs8) };
    await api('POST', 'me/password', fields);
    Object.assign(me, { kdf_salt: salt, enc_privkey: fields.enc_privkey });
  },

  // ---- Gesprekssleutels (ECIES: tijdelijke ECDH-sleutel + HKDF + AES-GCM) ----

  async boxKey(shared) {
    const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc8('skitta-gesprekssleutel') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  async wrapFor(pubkey, raw) {
    const peer = await subtle().importKey('raw', unb64(pubkey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const shared = await subtle().deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256);
    const e = b64(new Uint8Array(await subtle().exportKey('raw', eph.publicKey)));
    return JSON.stringify({ e, s: await seal(await this.boxKey(shared), raw) });
  },

  async unwrap(wrapped) {
    const w = JSON.parse(wrapped);
    const eph = await subtle().importKey('raw', unb64(w.e), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await subtle().deriveBits({ name: 'ECDH', public: eph }, this.priv, 256);
    return open(await this.boxKey(shared), w.s);
  },

  async addKey(c, v, raw) {
    this.keys.set(`${c}:${v}`, { raw, key: await aesKey(raw) });
    // Een nieuwere versie die iemand anders heeft gemaakt: die voortaan gebruiken.
    const conv = S.convs.get(c);
    if (conv && v > conv.key_version) conv.key_version = v;
  },

  async loadKeys(c) {
    if (!this.priv) return;
    const list = await api('GET', c ? `keys?c=${c}` : 'keys');
    await Promise.all(list.map(async (k) => {
      if (this.keys.has(`${k.c}:${k.v}`)) return;
      try { await this.addKey(k.c, k.v, await this.unwrap(k.w)); } catch {}
    }));
  },

  versions(c) {
    return [...this.keys.keys()].filter((k) => k.startsWith(`${c}:`)).map((k) => Number(k.split(':')[1]));
  },

  // Zorgt dat er een gesprekssleutel is die ik heb; zo nodig een nieuwe versie voor alle leden.
  async ensure(convId, tries = 0) {
    const conv = S.convs.get(convId);
    if (conv.key_version && !conv.rotate && this.keys.has(`${convId}:${conv.key_version}`)) return conv.key_version;
    const raw = rand(32);
    const v = conv.key_version + 1;
    const members = conv.members.filter((m) => !m.left && (m.id === S.me.id ? this.pub : m.pubkey));
    const keys = await Promise.all(members.map(async (m) => ({
      user_id: m.id, version: v, wrapped: await this.wrapFor(m.id === S.me.id ? this.pub : m.pubkey, raw)
    })));
    try {
      await api('POST', `conversations/${convId}/keys`, { rotate: true, keys });
    } catch (e) {
      if (e.status !== 409 || tries > 2) throw e;
      await refreshConv(convId);
      await this.loadKeys(convId);
      return this.ensure(convId, tries + 1);
    }
    await this.addKey(convId, v, raw);
    conv.key_version = v;
    conv.rotate = false;
    return v;
  },

  // Leden die een sleutel missen (nieuw in de groep, of een nieuw sleutelpaar na een wachtwoordreset)
  // krijgen alle versies die ik heb, zodat ze ook de eerdere berichten kunnen lezen.
  async fillMissing(conv) {
    const held = this.versions(conv.id);
    if (!held.length || !conv.missing?.length) return;
    for (const uid of conv.missing) {
      const m = conv.members.find((x) => x.id === uid);
      const tag = `${conv.id}:${uid}:${m?.pubkey}`;
      if (!m?.pubkey || uid === S.me.id || this.filling.has(tag)) continue;
      this.filling.add(tag);
      try {
        const keys = await Promise.all(held.map(async (v) => ({ user_id: uid, version: v, wrapped: await this.wrapFor(m.pubkey, this.keys.get(`${conv.id}:${v}`).raw) })));
        await api('POST', `conversations/${conv.id}/keys`, { keys });
      } catch {
        this.filling.delete(tag);
      }
    }
  },

  // ---- Berichten ----

  async encrypt(convId, text, bytes, mk = rand(32)) {
    const v = await this.ensure(convId);
    const mkKey = await aesKey(mk);
    const body = JSON.stringify({ kv: v, wk: await seal(this.keys.get(`${convId}:${v}`).key, mk), c: await seal(mkKey, enc8(text)) });
    return { body, mk: b64(mk), media: bytes ? await sealBytes(mkKey, bytes) : null };
  },

  // Zet m.b om naar leesbare tekst. m.raw houdt de versleutelde vorm, m.mk de berichtsleutel.
  // Een envelop openen: { text, mk }. Gooit een fout als de sleutel er (nog) niet is.
  async openEnvelope(c, raw, retry = true) {
    const e = JSON.parse(raw);
    let ck = this.keys.get(`${c}:${e.kv}`);
    if (!ck && retry) {
      await this.loadKeys(c);
      ck = this.keys.get(`${c}:${e.kv}`);
    }
    if (!ck) throw new Error('geen sleutel');
    const mk = await open(ck.key, e.wk);
    return { text: dec8(await open(await aesKey(mk), e.c)), mk: b64(mk) };
  },

  async decrypt(m, retry = true) {
    if (m.e && !m.del && !m.rm) {
      if (m.raw === undefined) m.raw = m.b;
      try {
        const o = await this.openEnvelope(m.c, m.raw, retry);
        m.mk = o.mk;
        m.b = o.text;
        m.locked = false;
      } catch {
        m.b = '';
        m.locked = true;
      }
    }
    // Reacties: elk een eigen kleine envelop met de emoji.
    m.reacts = [];
    for (const r of m.re || []) {
      try {
        const emo = (await this.openEnvelope(m.c, r.b, false)).text;
        if (emo && emo.length <= 16) m.reacts.push({ u: r.u, emo });
      } catch {}
    }
    return m;
  },

  async decryptAll(list) {
    const need = new Set();
    for (const m of list) {
      if (!m.e || m.del || m.rm) continue;
      const kv = parseJson(m.raw ?? m.b).kv;
      if (!this.keys.has(`${m.c}:${kv}`)) need.add(m.c);
    }
    for (const c of need) await this.loadKeys(c).catch(() => {});
    await Promise.all(list.map((m) => this.decrypt(m, false)));
    return list;
  },

  // Grote bestanden in stukken van 4 MB (elk met eigen iv), zodat niet alles tegelijk in het geheugen hoeft.
  async sealChunks(key, blob) {
    const parts = [];
    for (let i = 0; i < blob.size; i += CHUNK) parts.push(await sealBytes(key, new Uint8Array(await blob.slice(i, i + CHUNK).arrayBuffer())));
    return new Blob(parts, { type: 'application/octet-stream' });
  },

  async openChunks(key, blob, type) {
    const parts = [];
    for (let i = 0; i < blob.size; i += CHUNK + 28) parts.push(await openBytes(key, new Uint8Array(await blob.slice(i, i + CHUNK + 28).arrayBuffer())));
    return new Blob(parts, { type });
  },

  // Een groot bestand van de eigen bestandsserver halen en ontsleutelen.
  bigUrl(m, meta) {
    if (!this.media.has(meta.big)) {
      this.media.set(meta.big, (async () => {
        const t = await api('GET', `big/${encodeURIComponent(meta.big)}`);
        const res = await fetch(t.url, { headers: { authorization: `Bearer ${t.token}` } });
        if (!res.ok) throw new Error('niet gevonden');
        const plain = await this.openChunks(await aesKey(unb64(m.mk)), await res.blob(), meta.mime || 'application/octet-stream');
        return URL.createObjectURL(plain);
      })().catch(() => null));
    }
    return this.media.get(meta.big);
  },

  // Een versleutelde foto ophalen en als blob-URL teruggeven (één keer per foto).
  photoUrl(m, mime) {
    if (!this.media.has(m.media)) {
      this.media.set(m.media, (async () => {
        const res = await fetch(`/api/media/${encodeURIComponent(m.media)}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Foto niet gevonden');
        const plain = await openBytes(await aesKey(unb64(m.mk)), new Uint8Array(await res.arrayBuffer()));
        return URL.createObjectURL(new Blob([plain], { type: mime || sniffMime(plain) }));
      })().catch(() => null));
    }
    return this.media.get(m.media);
  }
};

function sniffMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

// Wachtwoord vragen als dit apparaat de sleutel nog niet heeft (bijv. na het wissen van browsergegevens).
function unlockDialog(me) {
  return new Promise((resolve) => {
    const pw = h('input', { class: 'field', type: 'password', autocomplete: 'current-password', autofocus: true });
    const err = h('div', { class: 'err' });
    const old = me.kdf_v === 0 || !me.pubkey;
    dialog(old ? 'Berichten versleutelen' : 'Berichten ontgrendelen', h('div', null,
      h('p', null, old
        ? 'Skitta versleutelt je berichten voortaan end-to-end. Vul nog één keer je wachtwoord in om je sleutel te maken.'
        : 'Je berichten zijn end-to-end versleuteld. Vul je wachtwoord in om ze op dit apparaat te kunnen lezen.'),
      h('div', { class: 'frow' }, h('label', null, 'Wachtwoord'), pw), err),
    [
      { label: 'Afmelden', left: true, run: (close) => { close(); resolve(false); logout(); } },
      {
        label: 'OK', default: true, run: async (close) => {
          err.textContent = '';
          try {
            await E2E.unlockWith(me, pw.value);
            close(true);
            resolve(true);
          } catch (e) {
            err.textContent = e.message;
          }
        }
      }
    ], { dismiss: false, closable: false });
  });
}

// ---------- Geluiden ----------

const OLD = ['BUSY', 'CALL_IN', 'CALL_INIT', 'CALL_OUT', 'HANGUP', 'HOLD', 'IM', 'ONLINE', 'RESUME'];

const Sound = {
  cache: new Map(),
  loops: new Map(),
  file(name) {
    return S.opts.classic && OLD.includes(name) ? `OLD_${name}` : name;
  },
  el(name) {
    const file = this.file(name);
    if (!this.cache.has(file)) {
      const a = new Audio(`/sounds/${file}.m4a`);
      a.preload = 'auto';
      this.cache.set(file, a);
    }
    return this.cache.get(file);
  },
  play(name, { loop = false, force = false } = {}) {
    // In de Android-app: geen geluid als de app niet in beeld is (dat doet de melding) of bij Niet storen.
    const nat = window.SkittaNative;
    if (nat?.inFront) {
      try {
        if (!nat.inFront() && !Call.active) return;
        if (nat.quiet() && !['HANGUP', 'CALL_OUT', 'CALL_INIT', 'BUSY', 'CALL_ERROR1'].includes(name)) return;
      } catch {}
    }
    if (!S.opts.sounds && !force) return;
    if (!force && S.me?.presence_pref === 'dnd' && !['LOGIN', 'LOGOUT', 'CALL_OUT', 'CALL_INIT', 'HANGUP', 'BUSY'].includes(name)) return;
    const a = loop ? new Audio(`/sounds/${this.file(name)}.m4a`) : this.el(name).cloneNode();
    a.loop = loop;
    a.volume = S.opts.volume;
    a.play().catch(() => {});
    if (loop) {
      this.stop(name);
      this.loops.set(name, a);
    }
    return a;
  },
  stop(name) {
    const a = this.loops.get(name);
    if (a) {
      a.pause();
      this.loops.delete(name);
    }
  },
  stopAll() {
    for (const name of [...this.loops.keys()]) this.stop(name);
  }
};

// ---------- Toestand ----------

const S = {
  me: null,
  contacts: new Map(),
  convs: new Map(),
  msgs: new Map(),
  users: new Map(),
  cur: 'home',
  tab: store('tab', window.innerWidth <= 720 ? 'recent' : 'contacts'),
  search: '',
  typing: new Map(),
  drafts: new Map(),
  editing: null,
  replyTo: null,
  ws: null,
  dev: uid(),
  ready: false,
  opts: {
    sounds: true, classic: false, sentSound: false, onlineSounds: true, notifications: false,
    enterSends: true, volume: 0.8, ...store('opts', {})
  }
};

function saveOpts() {
  save('opts', S.opts);
}

function userOf(id) {
  if (S.me && id === S.me.id) return S.me;
  return S.contacts.get(id) || S.users.get(id) || { id, display_name: 'Onbekend', username: '', avatar: null };
}

const nameOf = (id) => userOf(id).display_name || userOf(id).username;

function avatar(u, cls = '', status) {
  const a = h('span', { class: `avatar ${cls} ${u?.avatar ? '' : 'none'}` });
  if (u?.avatar) a.style.backgroundImage = `url("/api/media/${encodeURIComponent(u.avatar)}")`;
  if (status) a.append(h('span', { class: `st ${status}` }));
  return a;
}

const PRESENCE_LABEL = { online: 'Online', away: 'Afwezig', dnd: 'Niet storen', invisible: 'Onzichtbaar', offline: 'Offline' };

function statusClass(c) {
  if (!c) return 'unknown';
  if (c.state === 'blocked') return 'blocked';
  if (c.state === 'in' || c.state === 'out') return 'pending';
  return c.presence || 'offline';
}

function myPresence() {
  if (!S.me) return 'offline';
  if (!S.ws || S.ws.readyState !== 1) return 'offline';
  if (S.me.presence_pref === 'online' && S.me.idle) return 'away';
  return S.me.presence_pref;
}

function convTitle(conv) {
  if (!conv) return '';
  if (conv.kind === 'direct') return nameOf(otherId(conv));
  if (conv.topic) return conv.topic;
  const names = conv.members.filter((m) => !m.left && m.id !== S.me.id).map((m) => m.display_name.split(' ')[0]);
  return names.length ? names.join(', ') : 'Lege groep';
}

const otherId = (conv) => conv.members.find((m) => m.id !== S.me.id)?.id;

function directConvWith(id) {
  for (const c of S.convs.values()) if (c.kind === 'direct' && c.members.some((m) => m.id === id)) return c;
  return null;
}

// ---------- Aanmelden ----------

function showAuth(register = false) {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#login-form').hidden = register;
  $('#register-form').hidden = !register;
  document.title = 'Skitta';
  setTimeout(() => (register ? $('#r-display') : $('#l-name')).focus(), 0);
}

function setupAuth() {
  $('#to-register').onclick = (e) => { e.preventDefault(); showAuth(true); };
  $('#to-login').onclick = (e) => { e.preventDefault(); showAuth(false); };
  $('#forgot').onclick = (e) => {
    e.preventDefault();
    alertDialog('Kunt u zich niet aanmelden?', 'Wachtwoord vergeten? Vraag de beheerder van Skitta om een tijdelijk wachtwoord. Daarna kun je het zelf weer wijzigen via Skitta → Wachtwoord wijzigen.');
  };
  $('#l-presence').value = store('presence', 'online');

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#login-form .big-btn');
    btn.disabled = true;
    $('#login-err').textContent = '';
    try {
      save('presence', $('#l-presence').value);
      btn.textContent = 'Bezig met aanmelden…';
      await E2E.login($('#l-name').value.trim().toLowerCase(), $('#l-pass').value, {
        remember: $('#l-remember').checked, presence: $('#l-presence').value
      });
      $('#l-pass').value = '';
      await start(true);
    } catch (err) {
      $('#login-err').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Aanmelden';
    }
  };

  $('#register-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#register-err');
    err.textContent = '';
    if ($('#r-pass').value !== $('#r-pass2').value) {
      err.textContent = 'De wachtwoorden zijn niet hetzelfde';
      return;
    }
    if ($('#r-pass').value.length < 8) {
      err.textContent = 'Wachtwoord moet minimaal 8 tekens zijn';
      return;
    }
    const btn = $('#register-form .big-btn');
    btn.disabled = true;
    try {
      await E2E.register({
        display_name: $('#r-display').value, username: $('#r-name').value, email: $('#r-email').value
      }, $('#r-pass').value);
      await start(true, true);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  };
  $('#r-name').addEventListener('input', (e) => {
    const v = e.target.value.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    if (v !== e.target.value) e.target.value = v;
  });
}

async function logout() {
  if (Call.active || Call.incoming) Call.hangup();
  Sound.play('LOGOUT', { force: !!S.opts.sounds });
  const id = S.me?.id;
  await Push.disable().catch(() => {});
  try { Native.api?.signedOut?.(); } catch {}
  try { await api('POST', 'logout'); } catch {}
  await E2E.forget(id);
  signedOut();
}

function signedOut(message) {
  S.ready = false;
  S.me = null;
  if (S.ws) {
    S.ws.onclose = null;
    S.ws.close();
    S.ws = null;
  }
  clearTimeout(Live.retry);
  S.contacts.clear(); S.convs.clear(); S.msgs.clear(); S.users.clear();
  S.cur = 'home';
  closeLayer();
  showAuth(false);
  if (message) $('#login-err').textContent = message;
}

// ---------- Opstarten ----------

async function start(fresh = false, isNew = false) {
  try {
    S.me = await api('GET', 'me', undefined, { quiet: true });
  } catch (e) {
    if (e.status === 401) return showAuth(false);
    $('#auth').hidden = false;
    $('#login-err').textContent = e.message;
    return;
  }
  S.me.idle = false;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  buildMenubar();
  renderMe();
  if (!(await E2E.unlock(S.me))) return;
  await E2E.loadKeys().catch(() => {});
  await Promise.all([loadContacts(), loadConvs()]);
  S.ready = true;
  Live.connect();
  const hash = location.hash.match(/^#c(\d+)$/);
  if (hash && S.convs.has(Number(hash[1]))) openConv(Number(hash[1]));
  else showHome();
  renderList();
  if (fresh) Sound.play('LOGIN');
  Push.sync();
  renderNav();
  try { Native.api?.ready?.(); } catch {}
  if (isNew) setTimeout(() => profileDialog(), 400);
}

async function loadContacts() {
  const list = await api('GET', 'contacts');
  S.contacts = new Map(list.map((c) => [c.id, c]));
}

async function loadConvs() {
  const list = await api('GET', 'conversations');
  await E2E.decryptAll(list.map((c) => c.last).filter(Boolean));
  S.convs = new Map(list.map((c) => [c.id, c]));
  for (const c of list) for (const m of c.members) if (!S.contacts.has(m.id)) S.users.set(m.id, m);
  updateTitle();
  for (const c of list) if (c.missing?.length) E2E.fillMissing(c);
  for (const c of list) for (const m of c.members) Keys.check(m);
}

const refreshConv = () => loadConvs();

// Er zijn sleutels bijgekomen: berichten die nog op slot zaten opnieuw proberen.
async function onKeys(e) {
  await E2E.loadKeys(e.c).catch(() => {});
  const b = S.msgs.get(e.c);
  if (b) await E2E.decryptAll(b.list.filter((m) => m.locked));
  const conv = S.convs.get(e.c);
  if (conv?.last?.locked) await E2E.decrypt(conv.last, false);
  renderList();
  if (S.cur === e.c) renderMessages({ keepScroll: true });
}

function renderMe() {
  const me = S.me;
  const p = myPresence();
  $('#me-st').className = `st ${p === 'offline' ? 'offline' : me.presence_pref === 'invisible' ? 'invisible' : p}`;
  $('#me-name').textContent = me.display_name;
  const av = $('#me-avatar');
  av.className = `avatar me-avatar ${me.avatar ? '' : 'none'}`;
  av.style.backgroundImage = me.avatar ? `url("/api/media/${encodeURIComponent(me.avatar)}")` : '';
  if (document.activeElement !== $('#me-mood')) $('#me-mood').value = me.mood || '';
  updateTitle();
}

function updateTitle() {
  let unread = 0;
  for (const c of S.convs.values()) if (!c.left) unread += c.unread || 0;
  $('#recent-count').textContent = unread ? String(unread) : '';
  if ($('#mnav-count')) $('#mnav-count').textContent = unread ? String(unread) : '';
  document.title = `${unread ? `(${unread}) ` : ''}Skitta™${S.me ? ` - ${S.me.username}` : ''}`;
  if (navigator.setAppBadge) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch?.(() => {});
  Native.badge(unread);
}

// ---------- Live verbinding ----------

const Live = {
  retry: null,
  delay: 1000,
  pinger: null,
  connect() {
    if (!S.me) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws?dev=${S.dev}`);
    S.ws = ws;
    ws.onopen = () => {
      this.delay = 1000;
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ t: 'ping' }), 25000);
      if (Idle.idle) this.send({ t: 'idle', on: true });
      renderMe();
      if (this.wasDown) this.resync();
      this.wasDown = false;
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onEvent(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.pinger);
      if (S.ws !== ws) return;
      S.ws = null;
      this.wasDown = true;
      renderMe();
      if (e.code === 4001) return;
      this.retry = setTimeout(async () => {
        try {
          await api('GET', 'me', undefined, { quiet: true });
        } catch (err) {
          if (err.status === 401) return signedOut('Je bent afgemeld.');
        }
        this.connect();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30000);
    };
  },
  send(m) {
    if (S.ws?.readyState === 1) {
      S.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  },
  // Na een onderbreking alles bijwerken wat we gemist kunnen hebben.
  async resync() {
    try {
      await Promise.all([loadContacts(), loadConvs()]);
      if (typeof S.cur === 'number' && S.msgs.has(S.cur)) {
        const list = S.msgs.get(S.cur).list;
        const last = list.filter((m) => m.id).at(-1);
        if (last) {
          const r = await api('GET', `conversations/${S.cur}/messages?after=${last.id}`);
          await E2E.decryptAll(r.messages);
          for (const m of r.messages) upsertMessage(m);
        }
      }
      renderList();
      renderPane();
    } catch {}
  }
};

// Afwezig na 5 minuten niets doen.
const Idle = {
  idle: false,
  timer: null,
  poke() {
    clearTimeout(this.timer);
    if (this.idle) {
      this.idle = false;
      Live.send({ t: 'idle', on: false });
    }
    this.timer = setTimeout(() => {
      this.idle = true;
      Live.send({ t: 'idle', on: true });
    }, 5 * 60e3);
  }
};
for (const ev of ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'focus']) {
  window.addEventListener(ev, () => Idle.poke(), { passive: true });
}

function onEvent(e) {
  if (!S.ready) return;
  switch (e.t) {
    case 'presence': return onPresence(e);
    case 'msg': return onMessage(e.m);
    case 'typing': return onTyping(e);
    case 'read': return onRead(e);
    case 'contacts': return onContacts(e);
    case 'conv': return onConv(e);
    case 'call': return Call.onSignal(e);
    case 'keys': return onKeys(e);
    case 'announcement':
      S.me.announcement = e.text;
      if (S.cur === 'home') renderPane();
      if (e.text) toast({ title: 'Mededeling van Skitta', text: e.text, onclick: showHome });
      return;
    case 'warning':
      Sound.play('CALL_ERROR2', { force: true });
      alertDialog('Waarschuwing van de beheerder', 'Een bericht van jou is gemeld en door de beheerder afgekeurd. Het bericht is verwijderd. Houd je aan de regels, anders kan je account worden geblokkeerd.');
      return;
    case 'kick':
      return signedOut('Je account is geblokkeerd door de beheerder.');
  }
}

function onPresence(e) {
  if (e.u === S.me.id) {
    if (e.own) S.me.presence_pref = e.own;
    S.me.idle = !!e.idle;
    renderMe();
    return;
  }
  const c = S.contacts.get(e.u);
  if (!c || c.presence === e.p) return;
  const was = c.presence;
  c.presence = e.p;
  if (e.p === 'offline') c.last_seen = Date.now();
  if (S.opts.onlineSounds && c.state === 'ok') {
    if (was === 'offline' && e.p !== 'offline') {
      Sound.play('ONLINE');
      if (S.opts.onlineToasts) toast({ user: c, title: c.display_name, text: 'is nu online' });
    } else if (e.p === 'offline' && was !== 'offline') Sound.play('OFFLINE');
  }
  renderList();
  if (typeof S.cur === 'number' && S.convs.get(S.cur)?.members.some((m) => m.id === e.u)) renderHead();
}

async function onContacts(e) {
  const before = new Map(S.contacts);
  await loadContacts();
  if (e.request && S.contacts.get(e.request)?.state === 'in' && before.get(e.request)?.state !== 'in') {
    const c = S.contacts.get(e.request);
    Sound.play('INCOMING_AUTH');
    toast({ user: c, title: c.display_name, text: 'wil je toevoegen als contactpersoon', onclick: () => openContact(c.id) });
  }
  if (e.accepted && S.contacts.get(e.accepted)?.state === 'ok') {
    const c = S.contacts.get(e.accepted);
    Sound.play('USER_ADDED');
    toast({ user: c, title: c.display_name, text: 'heeft je verzoek geaccepteerd', onclick: () => openContact(c.id) });
  }
  renderList();
  renderPane();
}

async function onConv(e) {
  await loadConvs();
  if (e.added?.includes(S.me.id) && S.convs.get(e.c)) {
    Sound.play('USER_ADDED');
    toast({ title: convTitle(S.convs.get(e.c)), text: 'Je bent toegevoegd aan een groepsgesprek', onclick: () => openConv(e.c) });
  }
  renderList();
  if (S.cur === e.c) renderPane();
}

// ---------- Berichten bijhouden ----------

function bucket(convId) {
  if (!S.msgs.has(convId)) S.msgs.set(convId, { list: [], more: true, loaded: false });
  return S.msgs.get(convId);
}

// Voegt een bericht toe of werkt het bij. Geeft true terug als het nieuw is.
function upsertMessage(m) {
  const b = bucket(m.c);
  let i = b.list.findIndex((x) => (x.id && x.id === m.id) || (m.cid && x.cid === m.cid && x.u === m.u));
  if (i >= 0) {
    b.list[i] = { ...m };
    return false;
  }
  i = b.list.length;
  while (i > 0 && b.list[i - 1].id && b.list[i - 1].id > m.id) i--;
  b.list.splice(i, 0, { ...m });
  return true;
}

async function onMessage(m) {
  await E2E.decrypt(m);
  let conv = S.convs.get(m.c);
  if (!conv) {
    await loadConvs();
    conv = S.convs.get(m.c);
    if (!conv) return;
  }
  const isNew = bucket(m.c).loaded ? upsertMessage(m) : !(conv.last && conv.last.id >= m.id);
  if (!conv.last || conv.last.id <= m.id) conv.last = m;
  if (isNew) conv.last_at = Math.max(conv.last_at, m.at);

  if (isNew && m.k === 'system') {
    const d = parseJson(m.b);
    if (d.e === 'topic') conv.topic = d.topic;
    if (d.e === 'added' || d.e === 'left') await loadConvs();
    if (d.e === 'added' && m.u !== S.me.id) Sound.play('USER_ADDED');
    if (d.e === 'left' && m.u !== S.me.id) Sound.play('USER_LEFT');
  }

  if (isNew && m.k === 'call') { S.calls = null; if (S.tab === 'calls') loadCalls(); }
  if (isNew && m.u !== S.me.id && m.k !== 'system') {
    stopTyping(m.c, m.u);
    const visible = S.cur === m.c && document.visibilityState === 'visible' && document.hasFocus();
    if (visible) markRead(m.c, m.id);
    else {
      conv.unread = (conv.unread || 0) + 1;
      if (!isMuted(conv) && !(m.k === 'call' && parseJson(m.b).missed && Call.lastMissedNotice === m.c)) notifyMessage(conv, m);
    }
    if (m.k !== 'call' && !isMuted(conv)) Sound.play('IM');
  }
  updateTitle();
  renderList();
  if (S.cur === m.c && !(isNew && appendMessage(m))) renderMessages({ keepScroll: !isNew || m.u !== S.me.id });
}

// Een nieuw bericht onderaan toevoegen zonder de hele chat opnieuw op te bouwen.
// Lukt dat niet netjes (zoeken, andere dag, verborgen, "Gezien"), dan bouwt renderMessages alles opnieuw.
function appendMessage(m) {
  const chat = $('#chat');
  const conv = S.convs.get(m.c);
  const list = bucket(m.c).list;
  if (!chat || !conv || S.find || list.at(-1) !== list.find((x) => x.id === m.id) || chat.querySelector('.seen')) return false;
  const prev = list.at(-2);
  if (!prev || dayKey(prev.at) !== dayKey(m.at)) return false;
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
  const first = prev.u !== m.u || prev.k === 'system' || m.k === 'system' || m.at - prev.at > 10 * 60e3;
  chat.append(messageRow(m, first, conv));
  if (nearBottom || m.u === S.me.id) chat.scrollTop = chat.scrollHeight;
  return true;
}

function notifyMessage(conv, m) {
  const u = userOf(m.u);
  const text = previewText(m);
  const title = conv.kind === 'group' ? `${u.display_name} in ${convTitle(conv)}` : u.display_name;
  toast({ user: u, title, text, onclick: () => openConv(conv.id) });
  if (document.visibilityState !== 'visible' || !document.hasFocus()) showLocal(title, text, conv.id);
}

function parseJson(s) {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}

function previewText(m) {
  if (!m) return '';
  if (m.rm) return 'Bericht verwijderd door de beheerder';
  if (m.del) return 'Bericht verwijderd';
  if (m.locked) return '🔒 Versleuteld bericht';
  if (m.k === 'photo') {
    const meta = attachMeta(m);
    if (meta.t === 'video') return '🎬 Video';
    if (meta.t === 'voice') return `🎤 Spraakbericht${meta.dur ? ` (${duration(meta.dur)})` : ''}`;
    if (meta.t === 'file') return `📎 ${meta.name || 'Bestand'}`;
    return meta.cap ? `📷 ${meta.cap}` : '📷 Foto';
  }
  if (m.k === 'call') return callText(m);
  if (m.k === 'system') return systemText(m);
  return m.b.replace(/^> .+?: .*\n/, '').replace(EMO_RE, (x, pre, code) => pre + (EMO_MAP.get(code.toLowerCase()) || code));
}

function callText(m) {
  const d = parseJson(m.b);
  const kind = d.video ? 'Videogesprek' : 'Gesprek';
  if (d.failed) return `${kind} mislukt`;
  if (d.missed) return m.u === S.me.id ? `${kind} niet beantwoord` : `Gemiste oproep van ${nameOf(m.u)}`;
  return `${kind}, ${duration(d.dur || 0)}`;
}

function systemText(m) {
  const d = parseJson(m.b);
  const who = m.u === S.me.id ? 'Je' : nameOf(m.u);
  const names = (ids) => (ids || []).map((id) => (id === S.me.id ? 'jou' : nameOf(id))).join(', ');
  switch (d.e) {
    case 'created': return `${who} heeft een groepsgesprek gestart met ${names(d.ids)}`;
    case 'added': return `${who} heeft ${names(d.ids)} toegevoegd aan dit gesprek`;
    case 'left': return `${who} ${m.u === S.me.id ? 'hebt' : 'heeft'} dit gesprek verlaten`;
    case 'topic': return d.topic ? `${who} heeft het onderwerp gewijzigd in "${d.topic}"` : `${who} heeft het onderwerp verwijderd`;
    case 'expire': return d.s ? `${who} heeft verdwijnende berichten ingesteld op ${expireLabel(d.s)}` : `${who} heeft verdwijnende berichten uitgezet`;
    default: return '';
  }
}

const EXPIRE_OPTIONS = [[0, 'Uit'], [300, '5 minuten'], [3600, '1 uur'], [28800, '8 uur'], [86400, '1 dag'], [604800, '1 week'], [2419200, '4 weken']];
const expireLabel = (s) => EXPIRE_OPTIONS.find(([v]) => v === s)?.[1] || `${s} seconden`;
const isMuted = (conv) => (conv?.muted_until || 0) > Date.now();

async function setConvMe(conv, data) {
  Object.assign(conv, data);
  renderList();
  renderHead();
  try { await api('PATCH', `conversations/${conv.id}/me`, data); } catch (e) { toastError(e.message); }
}

function muteItems(conv) {
  const until = (ms) => () => setConvMe(conv, { muted_until: Date.now() + ms });
  return isMuted(conv)
    ? [{ label: 'Meldingen weer aanzetten', icon: 'bell', run: () => setConvMe(conv, { muted_until: 0 }) }]
    : [
      { label: '1 uur', run: until(3600e3) }, { label: '8 uur', run: until(8 * 3600e3) },
      { label: '1 dag', run: until(86400e3) }, { label: '1 week', run: until(7 * 86400e3) },
      { label: 'Altijd', run: () => setConvMe(conv, { muted_until: 4102444800000 }) }
    ];
}

function expireItems(conv) {
  return EXPIRE_OPTIONS.map(([v, label]) => ({
    label, checked: (conv.expire || 0) === v,
    run: async () => {
      try { await api('PATCH', `conversations/${conv.id}/expire`, { expire: v }); conv.expire = v; } catch (e) { toastError(e.message); }
    }
  }));
}

function convOptions(conv) {
  return [
    { label: conv.pinned ? 'Losmaken' : 'Vastpinnen', run: () => setConvMe(conv, { pinned: !conv.pinned }) },
    { label: isMuted(conv) ? 'Gedempt' : 'Dempen', sub: muteItems(conv) },
    { label: 'Verdwijnende berichten', sub: expireItems(conv) },
    { label: conv.archived ? 'Uit archief halen' : 'Archiveren', run: () => { setConvMe(conv, { archived: !conv.archived }); if (!conv.archived) return; showHome(); } },
    { label: 'Zoeken in gesprek…', icon: 'search', run: () => { openConv(conv.id); openFind(); } },
    conv.kind === 'direct' && { label: 'Veiligheidsnummer…', run: () => safetyDialog(otherId(conv)) }
  ];
}

// Verdwenen berichten ook op het scherm weghalen.
setInterval(() => {
  const now = Date.now();
  for (const [c, b] of S.msgs) {
    const before = b.list.length;
    b.list = b.list.filter((m) => !m.x || m.x > now);
    if (b.list.length !== before && S.cur === c) renderMessages({ keepScroll: true });
  }
}, 15000);

// ---------- Veiligheidsnummers ----------
// Iedereen heeft één sleutelpaar. Verandert de sleutel van een contactpersoon (bijv. na een
// wachtwoordreset), dan waarschuwt Skitta. Met het veiligheidsnummer controleer je samen dat niemand
// (ook de server niet) tussen jullie zit: zijn de nummers op beide telefoons gelijk, dan klopt het.

const Keys = {
  known: store('keys', {}),
  check(user) {
    if (!user?.pubkey || user.id === S.me?.id) return 'ok';
    const k = this.known[user.id];
    if (!k) {
      this.known[user.id] = { pub: user.pubkey, verified: false };
      save('keys', this.known);
      return 'new';
    }
    if (k.pub !== user.pubkey) return 'changed';
    return k.verified ? 'verified' : 'ok';
  },
  accept(user, verified = false) {
    this.known[user.id] = { pub: user.pubkey, verified };
    save('keys', this.known);
  }
};

async function safetyNumber(a, b) {
  const [x, y] = [a, b].sort();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', enc8(`skitta-veiligheidsnummer|${x}|${y}`)));
  const groups = [];
  for (let i = 0; i < 12; i++) {
    const n = ((digest[i * 4] << 24) | (digest[i * 4 + 1] << 16) | (digest[i * 4 + 2] << 8) | digest[i * 4 + 3]) >>> 0;
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups;
}

function memberUser(id) {
  for (const c of S.convs.values()) {
    const m = c.members.find((x) => x.id === id);
    if (m?.pubkey) return m;
  }
  return null;
}

async function safetyDialog(id) {
  const u = memberUser(id);
  if (!u || !E2E.pub) return alertDialog('Veiligheidsnummer', 'Begin eerst een gesprek met deze persoon.');
  const groups = await safetyNumber(E2E.pub, u.pubkey);
  const state = Keys.check(u);
  await dialog(`Veiligheidsnummer met ${u.display_name}`, h('div', null,
    h('p', null, `Vergelijk dit nummer met het nummer op het scherm van ${u.display_name} (samen, of via een ander kanaal). Zijn ze gelijk, dan is jullie gesprek echt alleen van jullie twee.`),
    h('div', { class: 'safety' }, groups.map((g) => h('span', null, g))),
    state === 'changed' ? h('p', { class: 'err' }, `Let op: de sleutel van ${u.display_name} is veranderd sinds de vorige keer.`) : null,
    state === 'verified' ? h('p', { style: { color: '#3f840c' } }, '✓ Je hebt dit nummer gecontroleerd.') : null),
  [
    { label: 'Gecontroleerd, klopt', default: true, run: (close) => { Keys.accept(u, true); close(true); renderPane(); } },
    { label: 'Sluiten', value: null }
  ], { width: 460 });
}

function keyWarning(conv) {
  if (conv.kind !== 'direct') return null;
  const u = conv.members.find((m) => m.id !== S.me.id);
  if (!u || Keys.check(u) !== 'changed') return null;
  return h('div', { class: 'notice' }, '⚠', h('span', { class: 'grow' }, `De veiligheidssleutel van ${u.display_name} is veranderd. Dat gebeurt als ${u.display_name} een nieuw wachtwoord heeft gekregen. Controleer het veiligheidsnummer als je het niet vertrouwt.`),
    h('button', { class: 'btn', onclick: () => safetyDialog(u.id) }, 'Controleren'),
    h('button', { class: 'btn', onclick: () => { Keys.accept(u); renderPane(); } }, 'Oké'));
}

function onTyping(e) {
  if (!S.typing.has(e.c)) S.typing.set(e.c, new Map());
  const map = S.typing.get(e.c);
  clearTimeout(map.get(e.u));
  if (e.on) map.set(e.u, setTimeout(() => stopTyping(e.c, e.u), 6000));
  else map.delete(e.u);
  if (S.cur === e.c) renderTyping();
}

function stopTyping(c, u) {
  const map = S.typing.get(c);
  if (!map?.has(u)) return;
  clearTimeout(map.get(u));
  map.delete(u);
  if (S.cur === c) renderTyping();
}

function onRead(e) {
  const conv = S.convs.get(e.c);
  if (!conv) return;
  const m = conv.members.find((x) => x.id === e.u);
  if (m) m.read = Math.max(m.read || 0, e.id);
  if (e.u !== S.me.id && S.cur === e.c) renderMessages({ keepScroll: true });
  if (e.u === S.me.id) {
    conv.unread = 0;
    conv.last_read = Math.max(conv.last_read || 0, e.id);
    updateTitle();
    renderList();
  }
}

let readTimer = null;
function markRead(convId, id) {
  const conv = S.convs.get(convId);
  if (!conv || !id) return;
  conv.unread = 0;
  updateTitle();
  if (id <= (conv.last_read || 0)) return;
  conv.last_read = id;
  clearTimeout(readTimer);
  readTimer = setTimeout(() => api('POST', `conversations/${convId}/read`, { id }).catch(() => {}), 400);
}

window.addEventListener('focus', () => {
  if (typeof S.cur !== 'number') return;
  const last = S.convs.get(S.cur)?.last;
  if (last?.id) markRead(S.cur, last.id);
  renderList();
});

// ---------- Lijst links ----------

function renderList() {
  if (!S.me) return;
  const list = $('#list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  $('#tab-contacts').classList.toggle('on', S.tab === 'contacts');
  $('#tab-recent').classList.toggle('on', S.tab === 'recent');
  $('#home-link').classList.toggle('on', S.cur === 'home');
  const q = S.search.trim().toLowerCase();
  const match = (u) => !q || u.display_name.toLowerCase().includes(q) || u.username.includes(q);

  if (S.tab === 'calls' && !q) {
    if (!S.calls) { loadCalls(); list.append(h('div', { class: 'empty' }, 'Laden…')); }
    else {
      const rows = S.calls.map(callRow).filter(Boolean);
      if (rows.length) list.append(...rows);
      else list.append(h('div', { class: 'empty' }, 'Nog geen gesprekken. Bel iemand vanuit een chat of je contacten.'));
    }
  } else if (S.tab === 'contacts' || q) {
    const all = [...S.contacts.values()].filter((c) => c.state !== 'blocked' && match(c));
    const requests = all.filter((c) => c.state === 'in');
    const rest = all.filter((c) => c.state !== 'in').sort((a, b) => {
      const ao = a.presence !== 'offline' && a.state === 'ok';
      const bo = b.presence !== 'offline' && b.state === 'ok';
      if (S.opts.onlineFirst !== false && ao !== bo) return ao ? -1 : 1;
      return a.display_name.localeCompare(b.display_name, 'nl');
    });
    if (requests.length) {
      list.append(h('div', { class: 'list-head' }, 'Verzoeken'));
      for (const c of requests) list.append(contactRow(c));
      list.append(h('div', { class: 'list-head' }, 'Contactpersonen'));
    }
    for (const c of rest) list.append(contactRow(c));
    if (q) {
      const groups = [...S.convs.values()].filter((c) => c.kind === 'group' && !c.left && convTitle(c).toLowerCase().includes(q));
      if (groups.length) {
        list.append(h('div', { class: 'list-head' }, 'Groepen'));
        for (const c of groups) list.append(convRow(c));
      }
      list.append(h('div', { class: 'row', onclick: () => addContactDialog(S.search) },
        h('span', { class: 'ico ico-add' }), h('span', { class: 'name' }, `Zoeken in Skitta naar "${S.search.trim()}"…`)));
    } else if (!all.length) {
      list.append(h('div', { class: 'empty' }, 'Je hebt nog geen contactpersonen.', h('br'), h('br'),
        h('button', { class: 'btn', onclick: () => addContactDialog() }, 'Contactpersoon toevoegen')));
    }
  } else {
    const all = [...S.convs.values()].filter((c) => c.last || c.kind === 'group');
    const shown = all.filter((c) => !!c.archived === !!S.showArchive)
      .sort((a, b) => (b.pinned - a.pinned) || (b.last_at - a.last_at));
    if (S.showArchive) list.append(h('div', { class: 'row', onclick: () => { S.showArchive = false; renderList(); } }, svg('back'), h('span', { class: 'name' }, 'Gearchiveerde chats')));
    for (const c of shown) list.append(convRow(c));
    const archived = all.filter((c) => c.archived).length;
    if (!S.showArchive && archived) list.append(h('div', { class: 'row archive-row', onclick: () => { S.showArchive = true; renderList(); } }, h('span', { class: 'name' }, `Gearchiveerd (${archived})`)));
    if (!shown.length) list.append(h('div', { class: 'empty' }, S.showArchive ? 'Geen gearchiveerde chats.' : 'Nog geen gesprekken.'));
  }
  list.scrollTop = scroll;
}

function contactRow(c) {
  const conv = directConvWith(c.id);
  const unread = conv?.unread || 0;
  const on = typeof S.cur === 'number' ? conv?.id === S.cur : S.cur === `u${c.id}`;
  const row = h('div', {
    class: `row ${on ? 'on' : ''} ${unread ? 'unread' : ''}`, tabindex: 0, title: `${c.display_name} (${c.username})`,
    onclick: () => openContact(c.id),
    oncontextmenu: (e) => { e.preventDefault(); contactMenu(c, e.clientX, e.clientY); },
    onkeydown: (e) => { if (e.key === 'Enter') openContact(c.id); }
  },
  avatar(c, 'list-av', statusClass(c)),
  h('span', { class: `st ${statusClass(c)}` }),
  h('div', { class: 'two-m' }, h('span', { class: 'name' }, c.display_name),
    h('span', { class: 'mood' }, c.state === 'in' ? 'wil je toevoegen' : c.state === 'out' ? 'wacht op goedkeuring' : c.mood)),
  unread ? h('span', { class: 'badge' }, unread) : null);
  return row;
}

function convRow(conv) {
  const unread = conv.unread || 0;
  const other = conv.kind === 'direct' ? S.contacts.get(otherId(conv)) : null;
  const st = conv.kind === 'group' ? 'group' : statusClass(other);
  const last = conv.last;
  const lastText = last ? `${last.u === S.me.id && last.k !== 'system' ? 'Jij: ' : ''}${previewText(last)}` : '';
  return h('div', {
    class: `row rich ${S.cur === conv.id ? 'on' : ''} ${unread ? 'unread' : ''} ${isMuted(conv) ? 'muted' : ''}`, tabindex: 0,
    onclick: () => openConv(conv.id),
    oncontextmenu: (e) => { e.preventDefault(); convMenu(conv, e.clientX, e.clientY); }
  },
  conv.kind === 'direct' ? avatar(S.contacts.get(otherId(conv)) || userOf(otherId(conv)), 'list-av', st) : h('span', { class: 'avatar group-av list-av' }),
  h('span', { class: `st ${st}` }),
  h('div', { class: 'two' }, h('span', { class: 'name' }, convTitle(conv)), h('span', { class: 'mood' }, lastText)),
  h('div', { class: 'side-info' },
    h('span', { class: 'when' }, shortWhen(conv.last_at)),
    h('span', { class: 'flags' }, conv.pinned ? '📌' : null, isMuted(conv) ? '🔕' : null, conv.expire ? '⏱' : null,
      unread ? h('span', { class: 'badge' }, unread) : null)));
}

// ---------- Rechterpaneel ----------

function showPaneOnMobile(on) {
  $('#app').classList.toggle('show-pane', on);
  renderNav();
}

function showHome() {
  saveDraft();
  S.cur = 'home';
  history.replaceState(null, '', location.pathname);
  showPaneOnMobile(window.innerWidth > 720);
  renderPane();
  renderList();
}

async function openContact(id) {
  const c = S.contacts.get(id);
  if (!c) return;
  if (c.state !== 'ok') {
    saveDraft();
    S.cur = `u${id}`;
    showPaneOnMobile(true);
    renderPane();
    renderList();
    return;
  }
  let conv = directConvWith(id);
  if (!conv) {
    try {
      conv = await api('POST', 'conversations', { user_id: id });
      S.convs.set(conv.id, conv);
    } catch (e) {
      return toastError(e.message);
    }
  }
  openConv(conv.id);
}

async function openConv(id) {
  const conv = S.convs.get(id);
  if (!conv) return;
  if (S.cur !== id) {
    saveDraft();
    S.editing = null;
    S.replyTo = null;
    S.find = null;
  }
  S.cur = id;
  history.replaceState(null, '', `#c${id}`);
  showPaneOnMobile(true);
  renderPane();
  renderList();
  const b = bucket(id);
  if (!b.loaded) {
    try {
      const r = await api('GET', `conversations/${id}/messages`);
      await E2E.decryptAll(r.messages);
      b.list = r.messages.concat(b.list.filter((m) => !m.id || m.id > (r.messages.at(-1)?.id || 0)));
      b.more = r.more;
      b.loaded = true;
    } catch (e) {
      toastError(e.message);
    }
    if (S.cur === id) renderMessages();
  }
  const last = b.list.filter((m) => m.id).at(-1);
  if (last) markRead(id, last.id);
  renderList();
  encryptOld(id);
  if (window.innerWidth > 720) setTimeout(() => $('#compose-text')?.focus(), 0);
}

// Berichten van vóór de versleuteling: de afzender versleutelt ze zelf alsnog.
async function encryptOld(convId) {
  const conv = S.convs.get(convId);
  if (!conv || conv.left) return;
  const old = bucket(convId).list.filter((m) => m.id && m.u === S.me.id && m.k === 'text' && !m.e && !m.del && !m.rm);
  for (const m of old) {
    try {
      const sealed = await E2E.encrypt(convId, m.b);
      const out = await api('PUT', `messages/${m.id}/encrypt`, { body: sealed.body });
      Object.assign(m, { e: out.e, raw: out.b, mk: sealed.mk });
    } catch {
      return;
    }
  }
}

function renderPane() {
  const pane = $('#pane');
  if (!S.me) return;
  if (S.cur === 'home') return pane.replaceChildren(homeView());
  if (typeof S.cur === 'string' && S.cur.startsWith('u')) return pane.replaceChildren(requestView(Number(S.cur.slice(1))));
  const conv = S.convs.get(S.cur);
  if (!conv) return showHome();
  // Wat er al in het invoerveld van dit gesprek stond, blijft staan als het paneel opnieuw wordt opgebouwd.
  const old = $('#compose-text');
  const carry = old && Number(old.dataset.c) === conv.id && !S.drafts.has(conv.id) ? old.value : null;
  const focused = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
  pane.replaceChildren(...[
    h('header', { class: 'conv-head', id: 'conv-head' }),
    Call.view(conv),
    findBar(conv),
    keyWarning(conv),
    h('div', { class: 'chat', id: 'chat' }),
    h('div', { class: 'typing', id: 'typing' }),
    composeView(conv)
  ].filter(Boolean));
  if (carry != null && $('#compose-text')) $('#compose-text').value = carry;
  if (focused && $('#compose-text')) {
    const ta = $('#compose-text');
    ta.focus();
    ta.setSelectionRange(...focused);
  }
  renderHead();
  renderMessages();
  renderTyping();
  setupDrop(pane, conv);
  requestAnimationFrame(() => { measureHead(); renderMessages(); });
}

function renderHead() {
  const head = $('#conv-head');
  const conv = S.convs.get(S.cur);
  if (!head || !conv) return;
  const back = h('button', { class: 'tool back', title: 'Terug', onclick: () => { saveDraft(); showPaneOnMobile(false); } }, svg('back'));
  const inCall = Call.active || Call.incoming;
  if (conv.kind === 'direct') {
    const c = S.contacts.get(otherId(conv)) || userOf(otherId(conv));
    const st = statusClass(S.contacts.get(c.id));
    const canTalk = S.contacts.get(c.id)?.state === 'ok';
    head.replaceChildren(
      back,
      h('button', { class: 'avatar-btn', style: { border: 0, padding: 0, background: 'none' }, onclick: () => contactProfile(c) }, avatar(c, 'lg')),
      h('div', { class: 'who' },
        h('h1', null, h('span', { class: `st ${st}` }), h('span', null, c.display_name)),
        h('div', { class: 'sub' }, c.mood || ''),
        h('div', { class: 'sub2' }, statusLine(S.contacts.get(c.id)))),
      h('div', { class: 'actions' },
        h('button', { class: 'sbtn blue', disabled: !canTalk || inCall, onclick: () => Call.start(c.id, true), title: 'Videogesprek' }, svg('video'), h('span', { class: 'lbl' }, 'Videogesprek')),
        h('button', { class: 'sbtn green', disabled: !canTalk || inCall, onclick: () => Call.start(c.id, false), title: 'Bellen' }, svg('phone'), h('span', { class: 'lbl' }, 'Bellen')),
        h('button', { class: 'sbtn blue round', title: 'Personen toevoegen', disabled: !canTalk, onclick: () => groupDialog([c.id]) }, svg('plus')),
        moreButton(conv))
    );
  } else {
    const members = conv.members.filter((m) => !m.left);
    head.replaceChildren(
      back,
      h('span', { class: 'avatar lg group-av' }),
      h('div', { class: 'who' },
        h('h1', null, h('span', null, convTitle(conv))),
        h('div', { class: 'sub' }, conv.left ? 'Je hebt dit gesprek verlaten' : `${members.length} deelnemers`),
        h('div', { class: 'member-strip' }, members.slice(0, 16).map((m) => {
          const c = S.contacts.get(m.id);
          const a = avatar(m, 'sm', m.id === S.me.id ? myPresence() : statusClass(c));
          a.title = m.display_name;
          return a;
        }))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', disabled: conv.left, onclick: () => topicDialog(conv) }, 'Onderwerp'),
        h('button', { class: 'sbtn blue round', title: 'Personen toevoegen', disabled: conv.left, onclick: () => addPeopleDialog(conv) }, svg('plus')),
        moreButton(conv))
    );
  }
}

function moreButton(conv) {
  const btn = h('button', { class: 'tool more-btn', title: 'Meer', onclick: () => {
    const r = btn.getBoundingClientRect();
    popMenu(convOptions(conv).concat(conv.kind === 'group' && !conv.left ? ['-', { label: 'Gesprek verlaten', icon: 'trash', run: () => leaveConv(conv) }] : []), r.right - 230, r.bottom + 2, { anchor: btn });
  } }, svg('more'));
  return btn;
}

function statusLine(c) {
  if (!c) return '';
  if (c.state === 'blocked') return 'Geblokkeerd';
  if (c.state !== 'ok') return 'Nog geen contactpersoon';
  if (c.presence === 'offline') return c.last_seen ? `Offline · laatst gezien ${ago(c.last_seen)}` : 'Offline';
  return PRESENCE_LABEL[c.presence] || '';
}

function homeView() {
  const requests = [...S.contacts.values()].filter((c) => c.state === 'in');
  const online = [...S.contacts.values()].filter((c) => c.state === 'ok' && c.presence !== 'offline');
  return h('div', { class: 'home' },
    h('div', { class: 'home-head' },
      h('img', { src: '/img/icon-192.png', alt: '' }),
      h('div', null, h('h1', null, 'Skitta Home'), h('p', null, `Welkom, ${S.me.display_name.split(' ')[0]}!`))),
    h('div', { class: 'home-body' },
      pushCard(),
      S.me.announcement ? h('div', { class: 'card announce' }, h('h2', null, 'Mededeling'), h('div', { class: 'card-body announce-text' }, S.me.announcement)) : null,
      requests.length ? h('div', { class: 'card' }, h('h2', null, 'Contactverzoeken'), h('div', { class: 'card-body' },
        requests.map((c) => h('div', { class: 'req' }, avatar(c), h('div', { class: 'grow' }, h('div', null, h('b', null, c.display_name), ` (${c.username})`), h('div', null, c.message)),
          h('button', { class: 'btn default', onclick: () => acceptContact(c.id) }, 'Accepteren'),
          h('button', { class: 'btn', onclick: () => removeContact(c.id, true) }, 'Weigeren'))))) : null,
      h('div', { class: 'card' }, h('h2', null, 'Nu online'), h('div', { class: 'card-body' },
        online.length
          ? online.map((c) => h('div', { class: 'req' }, avatar(c, '', statusClass(c)), h('div', { class: 'grow' }, h('div', null, h('b', null, c.display_name)), h('div', null, c.mood || PRESENCE_LABEL[c.presence])),
            h('button', { class: 'btn', onclick: () => openContact(c.id) }, 'Chatten'),
            h('button', { class: 'btn', onclick: () => Call.start(c.id, false) }, 'Bellen')))
          : h('div', { class: 'muted' }, 'Er zijn nu geen contactpersonen online.'))),
      Native.api ? null : h('div', { class: 'card' }, h('h2', null, 'Skitta als app'), h('div', { class: 'card-body' },
        h('ul', { class: 'tips' },
          h('li', null, h('a', { href: '/download/Skitta.apk' }, 'Android-app downloaden'), ' (APK). Met meldingen, ook als de app dicht is, en updates vanzelf.'),
          h('li', null, h('a', { href: '/download/Skitta-mac.zip' }, 'Mac-app downloaden'), '. Uitpakken, naar Programma\'s slepen, en de eerste keer met rechts klikken → Open.'),
          h('li', null, 'iPhone: open deze site in Safari, tik op Deel → ', h('b', null, 'Zet op beginscherm'), ', en zet daarna meldingen aan.')))),
      h('div', { class: 'card' }, h('h2', null, 'Aan de slag'), h('div', { class: 'card-body' },
        h('ul', { class: 'tips' },
          h('li', null, 'Je Skittanaam is ', h('b', null, S.me.username), '. Geef die aan je vrienden zodat ze je kunnen toevoegen.'),
          h('li', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); addContactDialog(); } }, 'Zoek vrienden'), ' op naam of Skittanaam en stuur een contactverzoek.'),
          h('li', null, 'Bel of videobel gratis met je contactpersonen, of start een ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); groupDialog(); } }, 'groepsgesprek'), '.'),
          h('li', null, 'Sleep een foto in een gesprek om hem te versturen.'),
          h('li', null, 'Klik met rechts op een bericht om het te bewerken, te citeren of te melden.'))))));
}

function requestView(id) {
  const c = S.contacts.get(id);
  if (!c) return homeView();
  const head = h('header', { class: 'conv-head' },
    h('button', { class: 'tool back', onclick: () => showPaneOnMobile(false) }, svg('back')),
    avatar(c, 'lg'),
    h('div', { class: 'who' }, h('h1', null, h('span', { class: `st ${statusClass(c)}` }), h('span', null, c.display_name)), h('div', { class: 'sub' }, c.username)));
  let body;
  if (c.state === 'in') {
    body = h('div', { class: 'auth-request' },
      h('p', null, h('b', null, c.display_name), ' wil je toevoegen aan de lijst met contactpersonen.'),
      h('div', { class: 'bubble' }, c.message),
      h('div', { class: 'btns' },
        h('button', { class: 'sbtn green', onclick: () => acceptContact(id) }, 'Accepteren'),
        h('button', { class: 'btn', onclick: () => removeContact(id, true) }, 'Weigeren'),
        h('button', { class: 'btn danger', onclick: () => blockContact(id) }, 'Blokkeren')));
  } else if (c.state === 'out') {
    body = h('div', { class: 'auth-request' },
      h('p', null, h('b', null, c.display_name), ' heeft je contactverzoek nog niet geaccepteerd.'),
      h('p', { class: 'muted' }, 'Zodra het verzoek is geaccepteerd, kun je chatten en bellen.'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => sendRequest(id) }, 'Verzoek opnieuw versturen'),
        h('button', { class: 'btn', onclick: () => removeContact(id) }, 'Verzoek intrekken')));
  } else {
    body = h('div', { class: 'auth-request' }, h('p', null, 'Je hebt deze persoon geblokkeerd.'),
      h('button', { class: 'btn', onclick: () => unblockContact(id) }, 'Blokkering opheffen'));
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, head, body);
}

// ---------- Berichten tonen ----------

function renderMessages({ keepScroll = false } = {}) {
  const chat = $('#chat');
  const conv = S.convs.get(S.cur);
  if (!chat || !conv) return;
  const b = bucket(conv.id);
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  const prevTop = chat.scrollTop;
  chat.replaceChildren();
  chat.classList.toggle('group', conv.kind === 'group');
  if (b.loaded && b.more) chat.append(h('button', { class: 'btn more', onclick: () => loadOlder(conv.id) }, 'Eerdere berichten laden'));
  if (b.loaded && !b.more) chat.append(h('div', { class: 'e2e-note' }, '🔒 Berichten en foto\'s in dit gesprek zijn end-to-end versleuteld. Alleen de mensen in dit gesprek kunnen ze lezen.'));
  if (!b.loaded) chat.append(h('div', { class: 'day' }, 'Laden…'));
  let lastDay = null;
  let prev = null;
  const q = S.find?.toLowerCase();
  const shown = q ? b.list.filter((m) => !m.del && !m.rm && (m.k === 'text' ? m.b.toLowerCase().includes(q) : (attachMeta(m)?.name || '').toLowerCase().includes(q))) : b.list;
  if (q) chat.append(h('div', { class: 'day' }, shown.length ? `${shown.length} gevonden` : 'Niets gevonden in de geladen berichten'));
  for (const m of shown) {
    const day = dayKey(m.at);
    if (day !== lastDay) {
      chat.append(h('div', { class: 'day' }, dayLabel(m.at)));
      lastDay = day;
      prev = null;
    }
    const first = !prev || prev.u !== m.u || prev.k === 'system' || m.k === 'system' || m.at - prev.at > 10 * 60e3;
    chat.append(messageRow(m, first, conv));
    prev = m;
  }
  // "Gezien" onder je laatste bericht in een gesprek met één persoon.
  if (conv.kind === 'direct' && !S.find) {
    const other = conv.members.find((x) => x.id !== S.me.id);
    const mine = b.list.filter((x) => x.id && x.u === S.me.id && x.k !== 'system').at(-1);
    if (mine && other?.read >= mine.id && b.list.filter((x) => x.id).at(-1)?.id === mine.id) {
      chat.append(h('div', { class: 'seen' }, `✓ Gezien`));
    }
  }
  if (b.loaded && !b.list.length) {
    chat.append(h('div', { class: 'day' }, conv.kind === 'direct' ? `Zeg hallo tegen ${convTitle(conv)}!` : 'Nog geen berichten'));
  }
  if (q) for (const el of chat.querySelectorAll('.msg .text')) markText(el, q);
  if (keepScroll && !nearBottom) chat.scrollTop = prevTop;
  else chat.scrollTop = chat.scrollHeight;
}

function markText(el, q) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const i = n.nodeValue.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const after = n.splitText(i);
    after.splitText(q.length);
    after.replaceWith(h('mark', null, after.nodeValue));
  }
}

function findBar(conv) {
  if (S.find == null) return null;
  const input = h('input', {
    class: 'field', type: 'search', placeholder: 'Zoeken in dit gesprek', value: S.find,
    oninput: () => { S.find = input.value; renderMessages(); },
    onkeydown: (e) => { if (e.key === 'Escape') closeFind(); }
  });
  setTimeout(() => input.focus(), 0);
  return h('div', { class: 'findbar', id: 'findbar' }, svg('search'), input,
    bucket(conv.id).more ? h('button', { class: 'btn', onclick: async (e) => {
      e.currentTarget.disabled = true;
      for (let i = 0; i < 40 && bucket(conv.id).more; i++) await loadOlder(conv.id);
      renderPane();
    } }, 'Ook oudere berichten') : null,
    h('button', { class: 'btn', onclick: closeFind }, 'Sluiten'));
}

function openFind() {
  if (typeof S.cur !== 'number') return;
  S.find = S.find || '';
  renderPane();
}

function closeFind() {
  S.find = null;
  renderPane();
}

async function loadOlder(convId) {
  const b = bucket(convId);
  const first = b.list.find((m) => m.id);
  if (!first) return;
  try {
    const r = await api('GET', `conversations/${convId}/messages?before=${first.id}`);
    await E2E.decryptAll(r.messages);
    b.list = r.messages.concat(b.list);
    b.more = r.more;
    if (S.cur === convId) {
      const chat = $('#chat');
      const h0 = chat.scrollHeight;
      const t0 = chat.scrollTop;
      renderMessages({ keepScroll: true });
      chat.scrollTop = chat.scrollHeight - h0 + t0;
    }
  } catch (e) {
    toastError(e.message);
  }
}

function messageRow(m, first, conv) {
  const mine = m.u === S.me.id;
  const cls = ['msg'];
  if (first) cls.push('first');
  if (mine) cls.push('mine');
  if (m.pending) cls.push('pending');
  if (m.failed) cls.push('failed');
  const from = h('div', { class: 'from' }, first && m.k !== 'system' ? nameOf(m.u) : '');
  let text;
  if (m.rm) {
    cls.push('gone');
    text = h('div', { class: 'text' }, 'Dit bericht is verwijderd door de beheerder.');
  } else if (m.del) {
    cls.push('gone');
    text = h('div', { class: 'text' }, 'Dit bericht is verwijderd.');
  } else if (m.k === 'system') {
    cls.push('sys');
    text = h('div', { class: 'text' }, systemText(m));
  } else if (m.k === 'call') {
    const d = parseJson(m.b);
    cls.push('call');
    if (d.missed || d.failed) cls.push('missed');
    text = h('div', { class: 'text' }, svg(d.video ? 'video' : 'phone'), callText(m));
  } else if (m.locked) {
    cls.push('gone');
    text = h('div', { class: 'text', title: 'Dit bericht komt binnen zodra iemand in het gesprek online is die de sleutel heeft' }, '🔒 Dit bericht kan nog niet worden ontsleuteld.');
  } else if (m.k === 'photo') {
    text = h('div', { class: 'text' }, attachmentView(m));
  } else {
    text = h('div', { class: `text ${onlyEmoji(m.b) ? 'big-emo' : ''}` }, richText(m.b), m.ed ? h('span', { class: 'edited', title: `Bewerkt om ${time(m.ed)}` }, '(bewerkt)') : null);
  }
  const t = h('div', {
    class: 'time', title: new Date(m.at).toLocaleString('nl-NL'),
    onclick: m.failed ? () => retrySend(m) : null
  }, m.failed ? 'Opnieuw' : m.pending ? '…' : time(m.at));
  // Op de telefoon staan tijd en vinkjes in de ballon.
  if (!['system'].includes(m.k)) {
    const tick = mine && !m.del && !m.rm ? (m.failed ? '!' : m.pending ? '🕓' : readByAll(conv, m) ? '✓✓' : '✓') : '';
    text.append(h('span', { class: `meta ${readByAll(conv, m) ? 'read' : ''}` },
      m.x ? h('span', { class: 'timer', title: `Verdwijnt ${new Date(m.x).toLocaleString('nl-NL')}` }, '⏱') : null,
      m.pending ? '' : time(m.at), tick ? h('span', { class: 'ticks' }, tick) : null));
    if (mine && !m.pending && !m.failed && !m.del && !m.rm && readByAll(conv, m)) t.append(h('span', { class: 'ticks read', title: 'Gelezen' }, ' ✓✓'));
  }
  if (m.reacts?.length) text.append(reactionChips(m, conv));
  const row = h('div', { class: cls.join(' '), 'data-id': m.id || '', 'data-cid': m.cid || '' }, from, text, t);
  row.addEventListener('contextmenu', (e) => {
    if (e.target.closest('a')) return;
    e.preventDefault();
    messageMenu(m, conv, e.clientX, e.clientY);
  });
  // Lang indrukken op een telefoon = rechtermuisklik.
  let press;
  row.addEventListener('touchstart', (e) => {
    const t0 = e.touches[0];
    press = setTimeout(() => messageMenu(m, conv, t0.clientX, t0.clientY), 550);
  }, { passive: true });
  for (const ev of ['touchend', 'touchmove', 'touchcancel']) row.addEventListener(ev, () => clearTimeout(press), { passive: true });
  return row;
}

// Gelezen door iedereen in het gesprek (alleen als zij leesbevestigingen delen).
function readByAll(conv, m) {
  if (!m.id || m.u !== S.me.id) return false;
  const others = conv.members.filter((x) => !x.left && x.id !== S.me.id);
  return others.length > 0 && others.every((x) => (x.read || 0) >= m.id);
}

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

function reactionChips(m, conv) {
  const groups = new Map();
  for (const r of m.reacts) {
    if (!groups.has(r.emo)) groups.set(r.emo, []);
    groups.get(r.emo).push(r.u);
  }
  return h('span', { class: 'reacts' }, [...groups].map(([emo, users]) => h('button', {
    class: `react ${users.includes(S.me.id) ? 'mine' : ''}`,
    title: users.map(nameOf).join(', '),
    onclick: (e) => { e.stopPropagation(); if (!conv.left) react(m, emo); }
  }, emo, users.length > 1 ? h('b', null, users.length) : null)));
}

async function react(m, emo) {
  const mineNow = m.reacts?.find((r) => r.u === S.me.id);
  try {
    const body = mineNow?.emo === emo ? '' : (await E2E.encrypt(m.c, emo)).body;
    const out = await api('PUT', `messages/${m.id}/reaction`, { body });
    await E2E.decrypt(out);
    upsertMessage({ ...m, ...out, b: m.b, raw: m.raw, mk: m.mk, locked: m.locked });
    renderMessages({ keepScroll: true });
  } catch (e) {
    toastError(e.message);
  }
}

async function hideForMe(m) {
  try {
    await api('POST', `messages/${m.id}/hide`);
    const b = bucket(m.c);
    b.list = b.list.filter((x) => x.id !== m.id);
    renderMessages({ keepScroll: true });
  } catch (e) {
    toastError(e.message);
  }
}

// Doorsturen: opnieuw versleutelen voor het andere gesprek (bijlagen worden opnieuw geüpload).
async function forwardDialog(m) {
  const convs = [...S.convs.values()].filter((c) => !c.left).sort((a, b) => b.last_at - a.last_at);
  const box = h('div', { class: 'pick-list' }, convs.map((c) => h('label', null,
    h('input', { type: 'checkbox', value: c.id }), h('span', { class: `st ${c.kind === 'group' ? 'group' : statusClass(S.contacts.get(otherId(c)))}` }), convTitle(c))));
  await dialog('Doorsturen', h('div', null, h('p', null, 'Naar welke gesprekken?'), box), [{
    label: 'Doorsturen', default: true, run: async (close) => {
      const ids = [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));
      close(true);
      for (const id of ids) {
        if (m.k === 'text') await sendText(id, m.b);
        else if (m.k === 'photo') {
          const meta = attachMeta(m);
          const url = m.localUrl || (meta.big ? await E2E.bigUrl(m, meta) : await E2E.photoUrl(m, meta.mime));
          if (!url) continue;
          const blob = await (await fetch(url)).blob();
          await sendFile(id, new File([blob], meta.name || 'bijlage', { type: meta.mime || blob.type }), { t: meta.t, dur: meta.dur });
        }
      }
      toast({ title: 'Doorgestuurd', text: `Naar ${ids.length} gesprek${ids.length === 1 ? '' : 'ken'}`, plain: true });
    }
  }, { label: 'Annuleren', value: null }]);
}

function renderTyping() {
  const el = $('#typing');
  if (!el) return;
  const ids = [...(S.typing.get(S.cur)?.keys() || [])];
  el.replaceChildren();
  if (!ids.length) return;
  const names = ids.map(nameOf);
  el.append(svg('pencil'), names.length === 1 ? `${names[0]} is aan het typen…` : `${names.join(' en ')} zijn aan het typen…`);
}

// ---------- Berichten versturen ----------

function composeView(conv) {
  const other = conv.kind === 'direct' ? S.contacts.get(otherId(conv)) : null;
  if (conv.left) return h('div', { class: 'compose disabled' }, 'Je hebt dit gesprek verlaten.');
  if (conv.kind === 'direct' && other?.state !== 'ok') {
    return h('div', { class: 'compose disabled' }, 'Je kunt deze persoon geen berichten sturen, omdat jullie geen contactpersonen (meer) zijn.');
  }
  const ta = h('textarea', {
    id: 'compose-text', placeholder: 'Typ hier een bericht', rows: 2, maxlength: 8000, 'data-c': conv.id,
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (S.opts.enterSends || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendFromCompose();
      } else if (e.key === 'ArrowUp' && !ta.value && !S.editing) {
        const mine = bucket(conv.id).list.filter((m) => m.u === S.me.id && m.k === 'text' && !m.del && !m.rm && m.id).at(-1);
        if (mine) { e.preventDefault(); startEdit(mine); }
      } else if (e.key === 'Escape' && (S.editing || S.replyTo)) {
        cancelEdit();
      }
    },
    oninput: () => { autoGrow(ta); typingPing(conv.id); sendIcon(); },
    onpaste: (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); for (const f of files) sendFile(conv.id, f); }
    }
  });
  ta.value = S.drafts.get(conv.id) || '';
  S.drafts.delete(conv.id);
  setTimeout(() => { autoGrow(ta); sendIcon(); }, 0);
  const file = h('input', {
    type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true,
    onchange: () => { for (const f of file.files) sendFile(conv.id, f); file.value = ''; }
  });
  const anyFile = h('input', {
    type: 'file', multiple: true, hidden: true,
    onchange: () => { for (const f of anyFile.files) sendFile(conv.id, f, { t: 'file' }); anyFile.value = ''; }
  });
  const banner = S.editing
    ? h('div', { class: 'editing' }, svg('pencil'), 'Bericht bewerken', h('a', { href: '#', onclick: (e) => { e.preventDefault(); cancelEdit(); } }, 'Annuleren'))
    : S.replyTo
      ? h('div', { class: 'reply' }, svg('quote'), h('span', null, `Citaat van ${nameOf(S.replyTo.u)}: ${previewText(S.replyTo)}`), h('a', { href: '#', onclick: (e) => { e.preventDefault(); cancelEdit(); } }, 'Annuleren'))
      : null;
  return h('div', { class: 'compose' },
    h('div', { class: 'compose-tools' },
      h('button', { class: 'tool', title: 'Emoticons', onclick: (e) => emoticonMenu(e.currentTarget, ta) }, smileyIcon()),
      h('button', { class: 'tool', title: 'Foto of video versturen', onclick: () => file.click() }, svg('photo'), h('span', { class: 'tlbl' }, 'Foto/video')),
      h('button', { class: 'tool', title: 'Bestand versturen', onclick: () => anyFile.click() }, svg('clip'), h('span', { class: 'tlbl' }, 'Bestand')),
      h('button', { class: 'tool', title: 'Spraakbericht opnemen', onclick: () => Voice.start(conv.id) }, svg('mic'), h('span', { class: 'tlbl' }, 'Spraakbericht')),
      file, anyFile),
    h('div', { class: 'rec-bar', id: 'rec-bar', hidden: true }),
    banner,
    h('div', { class: 'compose-box' },
      h('button', { class: 'm-only m-attach', title: 'Bijlage', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        popMenu([
          { label: 'Foto of video', icon: 'photo', run: () => file.click() },
          { label: 'Bestand', icon: 'clip', run: () => anyFile.click() }
        ], r.left, r.top - 90, { anchor: e.currentTarget });
      } }, svg('plus')),
      h('div', { class: 'm-field' },
        h('button', { class: 'm-only m-emo', title: 'Emoticons', onclick: (e) => emoticonMenu(e.currentTarget, ta) }, smileyIcon()),
        ta),
      h('button', { class: 'sbtn blue d-only', onclick: sendFromCompose, title: 'Verzenden (Enter)' }, S.editing ? 'Opslaan' : 'Verzenden'),
      h('button', { class: 'm-only m-send', id: 'm-send', title: 'Verzenden', onclick: () => {
        if ($('#compose-text').value.trim() || S.editing) sendFromCompose();
        else Voice.start(conv.id);
      } }, svg('mic'))));
}

function smileyIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.innerHTML = '<defs><radialGradient id="sm" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff6a8"/><stop offset=".6" stop-color="#ffd21f"/><stop offset="1" stop-color="#eaa400"/></radialGradient></defs><circle cx="8" cy="8" r="7" fill="url(#sm)" stroke="#c48a00"/><circle cx="5.7" cy="6.3" r="1" fill="#5a3b00"/><circle cx="10.3" cy="6.3" r="1" fill="#5a3b00"/><path d="M4.7 9.3c.8 1.6 2 2.3 3.3 2.3s2.5-.7 3.3-2.3" fill="none" stroke="#5a3b00" stroke-width="1.1" stroke-linecap="round"/>';
  return s;
}

// Telefoon: microfoon als er niets getypt is, anders het verzendpijltje.
function sendIcon() {
  const btn = $('#m-send');
  if (!btn) return;
  const hasText = !!$('#compose-text')?.value.trim() || !!S.editing;
  if (btn.dataset.mode === String(hasText)) return;
  btn.dataset.mode = String(hasText);
  btn.replaceChildren(svg(hasText ? 'send' : 'mic'));
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  const min = mobile() ? 42 : 44;
  ta.style.height = `${min}px`;
  ta.style.height = `${Math.min(160, Math.max(min, ta.scrollHeight + (mobile() ? 0 : 2)))}px`;
}

function saveDraft() {
  const ta = $('#compose-text');
  if (ta && typeof S.cur === 'number' && !S.editing) S.drafts.set(S.cur, ta.value);
}

let typingSent = 0;
let typingStop = null;
function typingPing(convId) {
  if (S.opts.typing === false) return;
  const now = Date.now();
  if (now - typingSent > 3000) {
    typingSent = now;
    Live.send({ t: 'typing', c: convId });
  }
  clearTimeout(typingStop);
  typingStop = setTimeout(() => { typingSent = 0; Live.send({ t: 'typing', c: convId, on: false }); }, 5000);
}

function startEdit(m) {
  saveDraft();
  S.editing = m;
  S.replyTo = null;
  renderPane();
  const ta = $('#compose-text');
  ta.value = m.b;
  ta.focus();
  autoGrow(ta);
}

function cancelEdit() {
  const wasEditing = !!S.editing;
  S.editing = null;
  S.replyTo = null;
  const keep = wasEditing ? '' : $('#compose-text')?.value || '';
  renderPane();
  const ta = $('#compose-text');
  if (ta) { ta.value = keep; ta.focus(); }
}

async function sendFromCompose() {
  const ta = $('#compose-text');
  const conv = S.convs.get(S.cur);
  if (!ta || !conv) return;
  let text = ta.value.trim();
  if (S.editing) {
    const m = S.editing;
    S.editing = null;
    ta.value = '';
    renderPane();
    if (text === m.b) return;
    try {
      if (!text) return deleteMsg(m);
      const sealed = await E2E.encrypt(m.c, text);
      const out = await api('PATCH', `messages/${m.id}`, { body: sealed.body, enc: 1 });
      Object.assign(out, { raw: out.b, b: text, mk: sealed.mk });
      upsertMessage(out);
      renderMessages({ keepScroll: true });
    } catch (e) {
      toastError(e.message);
    }
    return;
  }
  if (!text) return;
  if (S.replyTo) {
    const q = previewText(S.replyTo).replace(/\n/g, ' ').slice(0, 140);
    text = `> ${nameOf(S.replyTo.u)}: ${q}\n${text}`;
    S.replyTo = null;
    ta.value = '';
    renderPane();
  }
  ta.value = '';
  autoGrow(ta);
  clearTimeout(typingStop);
  typingSent = 0;
  Live.send({ t: 'typing', c: conv.id, on: false });
  await sendText(conv.id, text);
  $('#compose-text')?.focus();
}

async function sendText(convId, text, existing) {
  const cid = existing?.cid || uid();
  const local = existing || { id: 0, c: convId, u: S.me.id, k: 'text', b: text, at: Date.now(), cid, pending: true };
  local.pending = true;
  local.failed = false;
  if (!existing) bucket(convId).list.push(local);
  if (S.cur === convId) renderMessages();
  try {
    const sealed = await E2E.encrypt(convId, text);
    const m = await api('POST', `conversations/${convId}/messages`, { body: sealed.body, enc: 1, client_id: cid });
    Object.assign(m, { raw: m.b, b: text, mk: sealed.mk });
    upsertMessage(m);
    const conv = S.convs.get(convId);
    if (conv) { conv.last = m; conv.last_at = m.at; conv.last_read = m.id; }
    if (S.opts.sentSound) Sound.play('IM_SENT');
  } catch (e) {
    local.pending = false;
    local.failed = true;
    toastError(e.message);
  }
  if (S.cur === convId) renderMessages();
  renderList();
}

function retrySend(m) {
  if (m.k === 'photo' && m.file) return sendPhoto(m.c, m.file, m);
  sendText(m.c, m.b, m);
}

// Foto's verkleinen (max 1600 px, JPEG) voordat ze verstuurd worden; GIF's blijven zoals ze zijn.
async function prepareImage(file, max = 1600, quality = 0.85) {
  if (file.type === 'image/gif' && file.size < 1_400_000) {
    const bmp = await createImageBitmap(file).catch(() => null);
    return { blob: file, w: bmp?.width || 0, h: bmp?.height || 0 };
  }
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const hgt = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(bmp, 0, 0, w, hgt);
  let q = quality;
  let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
  while (blob && blob.size > 950_000 && q > 0.4) {
    q -= 0.15;
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
  }
  return { blob, w, h: hgt };
}

// ---------- Bijlagen: foto's, video's, spraakberichten en bestanden ----------
// Alles wordt eerst verkleind (foto's naar max. 1600 px JPEG, video's naar max. 960 px en ~700 kbit/s)
// en daarna versleuteld. De beschrijving (soort, naam, grootte, duur) zit in de versleutelde tekst.

const MAX_FILE = 5 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 180;
const MAX_VOICE_SECONDS = 300;

function attachMeta(m) {
  if (m.k !== 'photo') return null;
  if (m.b.startsWith('{"t":')) {
    const meta = parseJson(m.b);
    if (meta.t) return meta;
  }
  return { t: 'photo', cap: m.b };
}

function fileSize(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} kB`;
}

function kindOf(file) {
  if (/^image\/(jpeg|png|gif|webp|heic|heif|avif|bmp)$/.test(file.type)) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

// Video opnieuw opnemen op lagere resolutie en bitrate (canvas + MediaRecorder, in realtime).
async function prepareVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.preload = 'auto';
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Deze video kan niet worden geopend')); });
    const dur = v.duration;
    const w0 = v.videoWidth;
    const h0 = v.videoHeight;
    if (Number.isFinite(dur) && dur > MAX_VIDEO_SECONDS) throw new Error(`Video's mogen maximaal ${MAX_VIDEO_SECONDS / 60} minuten duren`);
    const small = (file.size <= 4 * 1024 * 1024 && Math.max(w0, h0) <= 1280) || (S.me.big_files && file.size <= 1024 ** 3);
    const canRecord = window.MediaRecorder && HTMLCanvasElement.prototype.captureStream;
    if (small || !canRecord) {
      if (file.size > MAX_FILE && !S.me.big_files) throw new Error('Deze video is te groot (max. 5 MB)');
      return { blob: file, w: w0, h: h0, dur, mime: file.type };
    }
    const scale = Math.min(1, 960 / Math.max(w0, h0));
    const w = Math.round((w0 * scale) / 2) * 2;
    const hh = Math.round((h0 * scale) / 2) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hh;
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    try {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    } catch {}
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 700_000, audioBitsPerSecond: 64_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    let raf;
    const draw = () => {
      g.drawImage(v, 0, 0, w, hh);
      onProgress?.(v.currentTime / (dur || 1));
      raf = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };
    rec.start(1000);
    await v.play();
    draw();
    await new Promise((res) => { v.onended = res; });
    rec.stop();
    await done;
    if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(raf); else cancelAnimationFrame(raf);
    const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
    if (blob.size > MAX_FILE && !S.me.big_files) throw new Error('Deze video is na verkleinen nog te groot (max. 5 MB)');
    return { blob: blob.size < file.size ? blob : file, w, h: hh, dur, mime: blob.size < file.size ? blob.type : file.type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Eén bijlage versturen. kind: 'photo', 'video', 'voice' of 'file'.
async function sendFile(convId, file, extra = {}, existing) {
  const kind = extra.t || kindOf(file);
  const cid = existing?.cid || uid();
  const meta = { t: kind, name: file.name || '', size: file.size, mime: file.type, ...extra };
  const local = existing || {
    id: 0, c: convId, u: S.me.id, k: 'photo', b: JSON.stringify(meta), at: Date.now(), cid, pending: true, file, extra,
    localUrl: URL.createObjectURL(file)
  };
  local.pending = true;
  local.failed = false;
  local.progress = '';
  if (!existing) bucket(convId).list.push(local);
  if (S.cur === convId) renderMessages();
  try {
    let blob = file;
    let w = 0;
    let hgt = 0;
    if (kind === 'photo') {
      const img = await prepareImage(file);
      ({ blob, w } = img);
      hgt = img.h;
      meta.mime = blob.type || 'image/jpeg';
    } else if (kind === 'video') {
      local.progress = 'Video verkleinen…';
      if (S.cur === convId) renderMessages({ keepScroll: true });
      const vid = await prepareVideo(file, (p) => {
        const el = document.querySelector(`[data-cid="${cid}"] .progress`);
        if (el) el.textContent = `Video verkleinen… ${Math.round(p * 100)}%`;
      });
      ({ blob, w } = vid);
      hgt = vid.h;
      meta.dur = Math.round(vid.dur || 0);
      meta.mime = vid.mime;
      meta.thumb = await videoThumb(blob);
    } else if (file.size > (S.me.big_files ? 1024 ** 3 : MAX_FILE)) {
      throw new Error(S.me.big_files ? 'Bestanden mogen maximaal 1 GB zijn' : 'Bestanden mogen maximaal 5 MB zijn');
    }
    meta.size = blob.size;
    local.w = w;
    local.h = hgt;
    local.progress = 'Versturen…';
    if (S.cur === convId) renderMessages({ keepScroll: true });
    if (blob.size > (S.me.big_files || Infinity)) {
      await sendBig(convId, blob, meta, local, cid);
      Sound.play('FT_COMPLETE');
      if (S.cur === convId) renderMessages({ keepScroll: true });
      renderList();
      return;
    }
    if (blob.size > MAX_FILE) throw new Error('Bestanden boven 5 MB kunnen pas als de bestandsserver aanstaat');
    const text = JSON.stringify(meta);
    const sealed = await E2E.encrypt(convId, text, new Uint8Array(await blob.arrayBuffer()));
    const res = await fetch(`/api/conversations/${convId}/photo?enc=1&w=${w}&h=${hgt}&cid=${cid}`, {
      method: 'POST', credentials: 'same-origin', body: sealed.media,
      headers: { 'content-type': 'application/octet-stream', 'x-skitta-body': sealed.body }
    });
    const m = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, m.error || 'De bijlage kon niet worden verstuurd');
    const localUrl = blob === file ? local.localUrl : URL.createObjectURL(blob);
    Object.assign(m, { raw: m.b, b: text, mk: sealed.mk });
    E2E.media.set(m.media, Promise.resolve(localUrl));
    upsertMessage({ ...m, localUrl });
    const conv = S.convs.get(convId);
    if (conv) { conv.last = m; conv.last_at = m.at; }
    Sound.play('FT_COMPLETE');
  } catch (e) {
    local.pending = false;
    local.failed = true;
    local.progress = '';
    Sound.play('FT_FAILED');
    toastError(e.message || 'De bijlage kon niet worden verstuurd');
  }
  if (S.cur === convId) renderMessages({ keepScroll: true });
  renderList();
}

// Grote bijlage: versleutelen in stukken, uploaden naar de eigen bestandsserver, dan het bericht sturen.
async function sendBig(convId, blob, meta, local, cid) {
  const mk = rand(32);
  local.progress = 'Versleutelen…';
  if (S.cur === convId) renderMessages({ keepScroll: true });
  const sealedBlob = await E2E.sealChunks(await aesKey(mk), blob);
  const ticket = await api('POST', `conversations/${convId}/big`, { size: sealedBlob.size });
  // In delen van 50 MB (een Cloudflare Tunnel neemt maximaal 100 MB per verzoek aan).
  const PART = 50 * 1024 * 1024;
  for (let offset = 0; offset < sealedBlob.size; offset += PART) {
    const part = sealedBlob.slice(offset, offset + PART);
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${ticket.url}?offset=${offset}`);
      xhr.setRequestHeader('authorization', `Bearer ${ticket.token}`);
      xhr.upload.onprogress = (e) => {
        const el = document.querySelector(`[data-cid="${cid}"] .progress`);
        if (el) el.textContent = `Uploaden… ${Math.round(((offset + e.loaded) / sealedBlob.size) * 100)}%`;
      };
      xhr.onload = () => ([201, 202].includes(xhr.status) ? resolve() : reject(new Error('Uploaden naar de bestandsserver is mislukt')));
      xhr.onerror = () => reject(new Error('De bestandsserver is niet bereikbaar'));
      xhr.send(part);
    });
  }
  meta.big = ticket.id;
  meta.until = ticket.expires_at;
  const text = JSON.stringify(meta);
  const sealed = await E2E.encrypt(convId, text, null, mk);
  const m = await api('POST', `conversations/${convId}/bigmsg`, { file: ticket.id, body: sealed.body, client_id: cid });
  const url = local.localUrl;
  Object.assign(m, { raw: m.b, b: text, mk: sealed.mk });
  E2E.media.set(ticket.id, Promise.resolve(url));
  upsertMessage({ ...m, localUrl: url });
  const conv = S.convs.get(convId);
  if (conv) { conv.last = m; conv.last_at = m.at; }
}

const sendPhoto = (convId, file, existing) => sendFile(convId, file, existing?.extra || {}, existing);

function mediaUrl(m, meta = attachMeta(m) || {}) {
  if (m.localUrl) return Promise.resolve(m.localUrl);
  if (meta.big) return E2E.bigUrl(m, meta);
  if (m.e) return E2E.photoUrl(m, meta.mime);
  return Promise.resolve(`/api/media/${encodeURIComponent(m.media)}`);
}

// Klein voorbeeldplaatje van een video (eerste beeld), gaat versleuteld mee in het bericht.
async function videoThumb(file) {
  const url = URL.createObjectURL(file);
  try {
    const v = h('video', { muted: true, playsinline: true, preload: 'auto' });
    v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 8000); });
    v.currentTime = Math.min(0.5, (v.duration || 1) / 3);
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 2000); });
    for (const [size, q] of [[240, 0.6], [160, 0.5], [120, 0.4]]) {
      const scale = size / Math.max(v.videoWidth, v.videoHeight);
      const c = h('canvas', { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length < 7000) return data;
    }
  } catch {} finally {
    URL.revokeObjectURL(url);
  }
  return null;
}

function attachmentView(m) {
  const meta = attachMeta(m) || { t: 'photo' };
  const wrap = h('div', { class: `att att-${meta.t}` });
  if (!m.media && !m.localUrl && !meta.big) {
    wrap.append(h('span', { class: 'muted' }, 'Deze bijlage is niet meer beschikbaar.'));
    return wrap;
  }
  if (meta.big && meta.until && meta.until < Date.now() && !m.localUrl) {
    wrap.append(h('span', { class: 'muted' }, `${meta.name || 'Bestand'} is verlopen en verwijderd.`));
    return wrap;
  }
  const getUrl = () => mediaUrl(m, meta);
  if (meta.t === 'photo') {
    const img = h('img', { class: 'photo', alt: 'Foto', onclick: () => Gallery.open(m) });
    if (m.w && m.h) {
      const scale = Math.min(1, 320 / m.w, 260 / m.h);
      img.style.width = `${Math.round(m.w * scale)}px`;
      img.style.aspectRatio = `${m.w} / ${m.h}`;
    }
    img.addEventListener('load', () => {
      const chat = $('#chat');
      if (chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 300) chat.scrollTop = chat.scrollHeight;
    }, { once: true });
    getUrl().then((u) => { if (u) img.src = u; else img.alt = 'Foto kon niet worden geladen'; });
    wrap.append(img);
  } else if (meta.t === 'video') {
    // Voorbeeldplaatje met afspeelknop; de video zelf laadt pas in de galerij.
    const box = h('button', { class: 'photo vthumb', title: 'Video afspelen', onclick: () => Gallery.open(m) },
      meta.thumb ? h('img', { src: meta.thumb, alt: '' }) : null,
      h('span', { class: 'vplay' }, svg('play')),
      h('span', { class: 'vdur' }, [meta.dur ? duration(meta.dur) : '', meta.size ? fileSize(meta.size) : ''].filter(Boolean).join(' · ')));
    const w = m.w || 16;
    const hh = m.h || 9;
    const scale = Math.min(320 / w, 240 / hh);
    box.style.width = `${Math.round(w * scale)}px`;
    box.style.aspectRatio = `${w} / ${hh}`;
    wrap.append(box);
  } else if (meta.t === 'voice') {
    const au = h('audio', { controls: true, preload: 'metadata' });
    getUrl().then((u) => { if (u) au.src = u; });
    wrap.append(h('span', { class: 'att-voice' }, svg('mic'), au, meta.dur ? h('span', { class: 'muted' }, duration(meta.dur)) : null));
  } else {
    const link = h('a', { class: 'att-file', href: '#', onclick: async (e) => {
      e.preventDefault();
      const u = await getUrl();
      if (!u) return toastError('Dit bestand kon niet worden geladen');
      if (Native.api?.save) {
        const blob = await (await fetch(u)).blob();
        const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        Native.api.save(meta.name || 'bestand', meta.mime || 'application/octet-stream', data);
        return;
      }
      const a = h('a', { href: u, download: meta.name || 'bestand' });
      document.body.append(a);
      a.click();
      a.remove();
    } }, h('span', { class: 'att-ico' }, fileIcon(meta.name)), h('span', { class: 'att-name' }, h('b', null, meta.name || 'Bestand'), h('span', { class: 'muted' }, fileSize(meta.size || 0))));
    wrap.append(link);
  }
  if (meta.big && meta.until && meta.until - (m.at || Date.now()) < 10 * 86400e3) {
    const days = Math.max(0, Math.ceil((meta.until - Date.now()) / 86400e3));
    wrap.append(h('div', { class: 'att-expire' }, `⏳ Grote bestanden blijven 1 week bewaard: dit bestand wordt ${days === 0 ? 'vandaag' : days === 1 ? 'morgen' : `over ${days} dagen`} automatisch verwijderd (${new Date(meta.until).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}).`));
  }
  if (meta.cap) wrap.append(h('div', null, richText(meta.cap)));
  if (m.progress) wrap.append(h('div', { class: 'progress muted' }, m.progress));
  return wrap;
}

function fileIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase().slice(0, 4);
  return ext && ext !== name.toLowerCase() ? ext.toUpperCase() : 'BESTAND';
}

// ---------- Spraakbericht opnemen ----------

const Voice = {
  rec: null,
  async start(convId) {
    if (this.rec) return;
    if (!window.MediaRecorder) return toastError('Spraakberichten worden in deze browser niet ondersteund');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return toastError('Skitta kan je microfoon niet gebruiken');
    }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 32_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.rec = { rec, stream, chunks, convId, start: Date.now(), cancel: false };
    rec.onstop = () => {
      const r = this.rec;
      this.rec = null;
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(r.tick);
      clearTimeout(r.limit);
      renderComposeBar();
      if (r.cancel) return;
      const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const dur = Math.round((Date.now() - r.start) / 1000);
      if (dur < 1) return;
      sendFile(r.convId, new File(chunks, `Spraakbericht.${ext}`, { type }), { t: 'voice', dur });
    };
    rec.start(1000);
    this.rec.tick = setInterval(() => {
      const el = $('#rec-time');
      if (el) el.textContent = duration(Math.round((Date.now() - this.rec.start) / 1000));
    }, 500);
    this.rec.limit = setTimeout(() => this.stop(), MAX_VOICE_SECONDS * 1000);
    renderComposeBar();
  },
  stop(cancel = false) {
    if (!this.rec) return;
    this.rec.cancel = cancel;
    this.rec.rec.stop();
  }
};

function renderComposeBar() {
  const bar = $('#rec-bar');
  if (!bar) return;
  bar.hidden = !Voice.rec;
  bar.replaceChildren();
  if (!Voice.rec) return;
  bar.append(h('span', { class: 'rec-dot' }), 'Spraakbericht opnemen ', h('b', { id: 'rec-time' }, '0:00'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => Voice.stop(true) }, 'Annuleren'),
    h('button', { class: 'sbtn blue', style: { height: '24px' }, onclick: () => Voice.stop() }, 'Versturen'));
}

function setupDrop(pane, conv) {
  if (conv.left) return;
  let hint = null;
  let depth = 0;
  pane.ondragenter = (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    depth++;
    if (!hint) { hint = h('div', { class: 'drop-hint' }, 'Laat los om te versturen'); pane.append(hint); }
  };
  pane.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); };
  pane.ondragleave = () => { if (--depth <= 0) { hint?.remove(); hint = null; depth = 0; } };
  pane.ondrop = (e) => {
    e.preventDefault();
    hint?.remove(); hint = null; depth = 0;
    for (const f of e.dataTransfer.files) sendFile(conv.id, f);
  };
}

// ---------- Menu's ----------

function closeLayer() {
  $('#layer').replaceChildren();
  for (const b of document.querySelectorAll('.menubar > button.open')) b.classList.remove('open');
}

// In de Android-app: hetzelfde menu als glazen menu van de app zelf (submenu's worden kopjes).
const glassPicks = new Map();
function glassMenu(items, x, y, anchor) {
  const nat = Native.api;
  if (!nat?.glassMenu) return false;
  glassPicks.clear();
  const rows = [];
  let n = 0;
  const add = (it) => {
    if (!it) return;
    if (it === '-') { if (rows.length) rows.push({ separator: true }); return; }
    if (it.sub) { rows.push({ heading: true, title: it.label }); it.sub.forEach(add); rows.push({ separator: true }); return; }
    const id = `m${n++}`;
    glassPicks.set(id, it.run);
    const row = { id, title: it.label, disabled: !!it.disabled, icon: ICONS[it.icon] || '' };
    if (it.checked !== undefined) row.checked = !!it.checked;
    if (/verwijder|afmelden|blokkeren/i.test(it.label)) row.destructive = true;
    rows.push(row);
  };
  items.forEach(add);
  while (rows.at(-1)?.separator) rows.pop();
  const r = anchor?.getBoundingClientRect?.() || { left: x, top: y, width: 1, height: 1 };
  try {
    return !!nat.glassMenu(JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, dark: document.documentElement.dataset.mode === 'dark', items: rows }));
  } catch {
    return false;
  }
}
window.skittaGlassPick = (id) => glassPicks.get(id)?.();
window.skittaOpen = (c) => { if (S.convs.has(Number(c))) openConv(Number(c)); return true; };
window.skittaToast = (text) => toast({ title: 'Skitta', text, plain: true });

// Terugknop van Android: eerst menu of venster dicht, dan terug naar de lijst.
window.skittaBack = () => {
  if (document.querySelector('#layer .menu, #layer .emo-pop')) { closeMenus(); return true; }
  if (document.querySelector('#layer .lightbox')) { closeLayer(); return true; }
  const close = document.querySelector('#layer .overlay:last-child .dclose');
  if (close) { close.click(); return true; }
  if (mobile() && $('#app').classList.contains('show-pane')) { saveDraft(); showPaneOnMobile(false); return true; }
  return false;
};

function popMenu(items, x, y, opts = {}) {
  if (!opts.child && glassMenu(items, x, y, opts.anchor)) return null;
  if (opts.child) for (const m of document.querySelectorAll('#layer .menu.child')) m.remove();
  else closeMenus();
  const menu = h('div', { class: `menu ${opts.child ? 'child' : ''}`, role: 'menu' });
  const openSub = (it, btn) => {
    const r = btn.getBoundingClientRect();
    popMenu(it.sub, r.right - 2, r.top - 3, { child: true });
  };
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { menu.append(h('div', { class: 'sep' })); continue; }
    const btn = h('button', {
      class: `mi ${it.checked ? 'checked' : ''} ${it.sub ? 'sub' : ''}`, role: 'menuitem', disabled: !!it.disabled,
      onclick: (e) => {
        e.stopPropagation();
        if (it.sub) return openSub(it, btn);
        closeMenus();
        it.run?.();
      },
      onmouseenter: () => {
        if (opts.child) return;
        for (const m of document.querySelectorAll('#layer .menu.child')) m.remove();
        if (it.sub) openSub(it, btn);
      }
    },
    h('span', { class: 'mi-ico' }, it.icon ? (it.icon.startsWith('st ') ? h('span', { class: it.icon }) : svg(it.icon)) : null),
    it.label, it.key ? h('span', { class: 'key' }, it.key) : null);
    menu.append(btn);
  }
  menu.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#layer').append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  if (!opts.child) setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true), 0);
  return menu;
}

function closeMenus() {
  for (const m of document.querySelectorAll('#layer .menu, #layer .emo-pop')) m.remove();
  for (const b of document.querySelectorAll('.menubar > button.open')) b.classList.remove('open');
  document.removeEventListener('pointerdown', outsideMenu, true);
}

function outsideMenu(e) {
  if (e.target.closest('.menu, .emo-pop, .menubar > button')) return;
  closeMenus();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && typeof S.cur === 'number' && S.me) {
    e.preventDefault();
    openFind();
    return;
  }
  if (e.key === 'Escape') {
    if (document.querySelector('#layer .menu, #layer .emo-pop')) closeMenus();
    else if (document.querySelector('#layer .lightbox')) closeLayer();
    else document.querySelector('#layer .overlay:last-child .dclose')?.click();
  }
});

function presenceItems() {
  const set = (p) => setPresence(p);
  const pref = S.me.presence_pref;
  return [
    { label: 'Online', icon: 'st online', checked: pref === 'online', run: () => set('online') },
    { label: 'Afwezig', icon: 'st away', checked: pref === 'away', run: () => set('away') },
    { label: 'Niet storen', icon: 'st dnd', checked: pref === 'dnd', run: () => set('dnd') },
    { label: 'Onzichtbaar', icon: 'st invisible', checked: pref === 'invisible', run: () => set('invisible') },
    '-',
    { label: 'Offline', icon: 'st offline', run: logout }
  ];
}

async function setPresence(p) {
  S.me.presence_pref = p;
  save('presence', p);
  renderMe();
  try { await api('PATCH', 'me', { presence: p }); } catch (e) { toastError(e.message); }
}

function contactMenu(c, x, y) {
  const ok = c.state === 'ok';
  popMenu([
    ok && { label: 'Bericht sturen', icon: 'chat', run: () => openContact(c.id) },
    ok && { label: 'Bellen', icon: 'phone', disabled: !!Call.active, run: () => Call.start(c.id, false) },
    ok && { label: 'Videogesprek', icon: 'video', disabled: !!Call.active, run: () => Call.start(c.id, true) },
    c.state === 'in' && { label: 'Accepteren', run: () => acceptContact(c.id) },
    c.state === 'in' && { label: 'Weigeren', run: () => removeContact(c.id, true) },
    '-',
    { label: 'Profiel bekijken', icon: 'user', run: () => contactProfile(c) },
    ok && { label: 'Groep maken met deze persoon…', icon: 'plus', run: () => groupDialog([c.id]) },
    '-',
    { label: c.state === 'out' ? 'Verzoek intrekken' : 'Verwijderen uit contactpersonen', icon: 'trash', run: () => confirmRemove(c) },
    { label: 'Deze persoon blokkeren…', icon: 'block', run: () => blockContact(c.id) }
  ], x, y);
}

function convMenu(conv, x, y) {
  popMenu([
    { label: 'Openen', icon: 'chat', run: () => openConv(conv.id) },
    ...convOptions(conv),
    '-',
    conv.unread ? { label: 'Markeren als gelezen', run: () => markRead(conv.id, conv.last?.id) } : null,
    conv.kind === 'group' && !conv.left && { label: 'Onderwerp wijzigen…', icon: 'pencil', run: () => topicDialog(conv) },
    conv.kind === 'group' && !conv.left && { label: 'Personen toevoegen…', icon: 'plus', run: () => addPeopleDialog(conv) },
    conv.kind === 'group' && !conv.left && '-',
    conv.kind === 'group' && !conv.left && { label: 'Gesprek verlaten', icon: 'trash', run: () => leaveConv(conv) }
  ], x, y);
}

function messageMenu(m, conv, x, y) {
  if (m.k === 'system' || !m.id) return;
  const mine = m.u === S.me.id;
  const gone = m.del || m.rm || m.locked;
  const canEdit = mine && m.k === 'text' && !gone && Date.now() - m.at < 24 * 3600e3 && !conv.left;
  const reactItems = !gone && !conv.left && m.k !== 'call'
    ? QUICK_REACTIONS.map((emo) => ({ label: emo, checked: m.reacts?.some((r) => r.u === S.me.id && r.emo === emo), run: () => react(m, emo) }))
    : null;
  if (mobile() && !Native.api?.glassMenu) return messageSheet(m, conv, reactItems);
  popMenu([
    reactItems && { label: 'Reageren', sub: reactItems },
    reactItems && '-',
    !gone && m.k === 'text' && !m.locked && { label: 'Kopiëren', icon: 'copy', run: () => navigator.clipboard?.writeText(m.b.replace(/^> .+?: .*\n/, '')) },
    !gone && !conv.left && m.k !== 'call' && { label: 'Citeren', icon: 'quote', run: () => { S.replyTo = m; S.editing = null; saveDraft(); renderPane(); $('#compose-text')?.focus(); } },
    !gone && m.k === 'photo' && ['photo', 'video'].includes(attachMeta(m)?.t) && { label: attachMeta(m).t === 'video' ? 'Video afspelen' : 'Foto openen', icon: 'photo', run: () => Gallery.open(m) },
    canEdit && '-',
    canEdit && { label: 'Bericht bewerken', icon: 'pencil', run: () => startEdit(m) },
    mine && !gone && m.k !== 'call' && { label: 'Bericht verwijderen', icon: 'trash', run: () => deleteMsg(m) },
    !gone && m.k !== 'call' && { label: 'Doorsturen…', icon: 'back', run: () => forwardDialog(m) },
    { label: 'Verwijderen voor mij', icon: 'trash', run: () => hideForMe(m) },
    !mine && !gone && m.k !== 'call' && '-',
    !mine && !gone && m.k !== 'call' && { label: 'Bericht melden…', icon: 'flag', run: () => reportDialog(m) }
  ], x, y);
}

// Telefoon: onderblad met snelle reacties en acties (zoals Signal).
function messageSheet(m, conv, reactItems) {
  closeMenus();
  const mine = m.u === S.me.id;
  const gone = m.del || m.rm || m.locked;
  const act = (label, run) => h('button', { class: 'sheet-item', onclick: () => { sheet.remove(); run(); } }, label);
  const sheet = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === sheet) sheet.remove(); } },
    h('div', { class: 'sheet' },
      reactItems ? h('div', { class: 'sheet-reacts' }, QUICK_REACTIONS.map((emo) => h('button', {
        class: m.reacts?.some((r) => r.u === S.me.id && r.emo === emo) ? 'on' : '', onclick: () => { sheet.remove(); react(m, emo); }
      }, emo))) : null,
      !gone && !conv.left && m.k !== 'call' ? act('Beantwoorden', () => { S.replyTo = m; S.editing = null; saveDraft(); renderPane(); $('#compose-text')?.focus(); }) : null,
      !gone && m.k === 'text' ? act('Kopiëren', () => navigator.clipboard?.writeText(m.b.replace(/^> .+?: .*\n/, ''))) : null,
      !gone && m.k !== 'call' ? act('Doorsturen', () => forwardDialog(m)) : null,
      mine && !gone && m.k === 'text' && Date.now() - m.at < 24 * 3600e3 ? act('Bewerken', () => startEdit(m)) : null,
      mine && !gone && m.k !== 'call' ? act('Verwijderen voor iedereen', () => deleteMsg(m)) : null,
      act('Verwijderen voor mij', () => hideForMe(m)),
      !mine && !gone && m.k !== 'call' ? act('Melden', () => reportDialog(m)) : null));
  $('#layer').append(sheet);
}

async function deleteMsg(m) {
  if (!(await confirmDialog('Bericht verwijderen', 'Weet je zeker dat je dit bericht wilt verwijderen? Het wordt voor iedereen in het gesprek verwijderd.', 'Verwijderen'))) return;
  try {
    upsertMessage(await api('DELETE', `messages/${m.id}`));
    renderMessages({ keepScroll: true });
  } catch (e) {
    toastError(e.message);
  }
}

function emoticonMenu(anchor, ta) {
  closeMenus();
  const pop = h('div', { class: 'menu emo-pop' }, h('div', { class: 'emo-grid' }, EMOTICONS.map(([code, emo]) =>
    h('button', {
      title: code,
      onclick: () => {
        const start = ta.selectionStart;
        const before = ta.value.slice(0, start);
        const ins = (before && !/\s$/.test(before) ? ' ' : '') + code + ' ';
        ta.setRangeText(ins, start, ta.selectionEnd, 'end');
        ta.focus();
        closeMenus();
      }
    }, emo))));
  pop.style.padding = '2px';
  pop.style.background = '#fff';
  $('#layer').append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pr.width - 4))}px`;
  pop.style.top = `${Math.max(4, r.top - pr.height - 4)}px`;
  setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true), 0);
}

// ---------- Menubalk ----------

function buildMenubar() {
  const bar = $('#menubar');
  bar.replaceChildren();
  const menus = [
    ['Skitta', () => [
      { label: 'Online-status', sub: presenceItems() },
      '-',
      { label: 'Profiel bewerken…', icon: 'user', run: profileDialog },
      { label: 'Wachtwoord wijzigen…', run: passwordDialog },
      '-',
      { label: 'Afmelden', run: logout }
    ]],
    ['Contactpersonen', () => [
      { label: 'Contactpersoon toevoegen…', icon: 'plus', run: () => addContactDialog() },
      { label: 'Groep maken…', icon: 'chat', run: () => groupDialog() },
      '-',
      { label: 'Online contactpersonen bovenaan', checked: S.opts.onlineFirst !== false, run: () => { S.opts.onlineFirst = S.opts.onlineFirst === false; saveOpts(); renderList(); } },
      { label: 'Geblokkeerde contactpersonen…', icon: 'block', run: blockedDialog }
    ]],
    ['Gesprek', () => {
      const conv = typeof S.cur === 'number' ? S.convs.get(S.cur) : null;
      const group = conv?.kind === 'group' && !conv.left;
      return [
        { label: 'Foto versturen…', icon: 'photo', disabled: !conv || conv.left, run: () => document.querySelector('.compose input[type=file]')?.click() },
        { label: 'Personen toevoegen…', icon: 'plus', disabled: !conv || conv.left, run: () => (group ? addPeopleDialog(conv) : groupDialog([otherId(conv)])) },
        { label: 'Onderwerp wijzigen…', icon: 'pencil', disabled: !group, run: () => topicDialog(conv) },
        '-',
        { label: 'Zoeken in gesprek…', icon: 'search', key: 'Ctrl+F', disabled: !conv, run: openFind },
        { label: 'Alles als gelezen markeren', run: markAllRead },
        { label: 'Gesprek verlaten', icon: 'trash', disabled: !group, run: () => leaveConv(conv) }
      ];
    }],
    ['Bellen', () => {
      const conv = typeof S.cur === 'number' ? S.convs.get(S.cur) : null;
      const target = conv?.kind === 'direct' ? otherId(conv) : null;
      return [
        { label: 'Bellen', icon: 'phone', disabled: !target || !!Call.active, run: () => Call.start(target, false) },
        { label: 'Videogesprek', icon: 'video', disabled: !target || !!Call.active, run: () => Call.start(target, true) },
        '-',
        { label: 'Microfoon dempen', icon: 'micoff', checked: Call.muted, disabled: !Call.active, run: () => Call.toggleMute() },
        { label: 'Video aan/uit', icon: 'video', disabled: !Call.active, run: () => Call.toggleVideo() },
        { label: 'Ophangen', icon: 'hangup', disabled: !Call.active && !Call.incoming, run: () => Call.hangup() },
        '-',
        { label: 'Geluid en video testen…', run: testDialog }
      ];
    }],
    ['Weergave', () => [
      { label: 'Skitta Home', run: showHome },
      { label: 'Contactpersonen', checked: S.tab === 'contacts', run: () => setTab('contacts') },
      { label: 'Recente gesprekken', checked: S.tab === 'recent', run: () => setTab('recent') },
      '-',
      { label: 'Versie', sub: themeItems() }
    ]],
    ['Extra', () => [
      { label: 'Opties…', run: optionsDialog },
      S.me.is_admin && '-',
      S.me.is_admin && { label: 'Beheer…', run: () => window.open('/beheer', '_blank') }
    ]],
    ['Help', () => [
      { label: 'Sneltoetsen', run: shortcutsDialog },
      { label: 'Over Skitta', run: aboutDialog }
    ]]
  ];
  for (const [label, items] of menus) {
    const btn = h('button', {
      onclick: (e) => {
        const wasOpen = btn.classList.contains('open');
        closeMenus();
        if (wasOpen) return;
        btn.classList.add('open');
        const r = btn.getBoundingClientRect();
        popMenu(items(), r.left, r.bottom);
        btn.classList.add('open');
        e.stopPropagation();
      },
      onmouseenter: () => {
        const open = bar.querySelector('button.open');
        if (open && open !== btn) btn.click();
      }
    }, label);
    bar.append(btn);
  }
}

// Versies door de jaren heen (alleen op de computer).
const THEMES = [
  ['v1', '1.0 (2003)'], ['v2', '2.0 (2006)'], ['v3', '3.0 (2007)'], ['v4', '4.0 (2009)'],
  ['', '5.0 · Windows 7 (2011, standaard)'], ['v5xp', '5.0 · Windows XP (2011)'], ['v6', '6 · Windows 8 (2013)'],
  ['v7', '7 (2014)'], ['v8', '8 (2017)'], ['v8dark', '8 donker (2019)'], ['v2021', '2021'],
  ['mac2', '2 voor Mac (2008)'], ['mac5', '5 voor Mac (2011)'], ['mac6', '6 voor Mac (2013)']
];

function setTheme(t) {
  S.opts.theme = t;
  saveOpts();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function themeItems() {
  return THEMES.map(([id, label]) => ({ label, checked: (S.opts.theme || '') === id, run: () => setTheme(id) }));
}

function setTab(tab) {
  S.tab = tab;
  save('tab', tab);
  renderList();
  renderNav();
}

// ---------- Navigatie op de telefoon ----------

const mobile = () => window.innerWidth <= 720;

function navActive() {
  return S.tab === 'recent' || S.tab === 'calls' ? S.tab : 'contacts';
}

function navTo(id) {
  if (id === 'add') return addMenu($('#mnav-add'));
  if (id === 'more') return moreMenu($('#mnav-pill [data-nav="more"]'));
  setTab(id);
  showPaneOnMobile(false);
  if (id === 'calls') loadCalls();
  renderNav();
}

// ---------- Bellen: recente gesprekken ----------

async function loadCalls() {
  try {
    S.calls = await api('GET', 'calls');
  } catch {
    return;
  }
  if (S.tab === 'calls') renderList();
}

function callRow(m) {
  const conv = S.convs.get(m.c);
  if (!conv) return null;
  const d = parseJson(m.b);
  const mine = m.u === S.me.id;
  const peer = conv.kind === 'direct' ? (S.contacts.get(otherId(conv)) || userOf(otherId(conv))) : null;
  const missed = (d.missed || d.failed) && !mine;
  const what = d.failed ? 'Mislukt' : d.missed ? (mine ? 'Niet beantwoord' : 'Gemist') : `${mine ? 'Uitgaand' : 'Inkomend'} · ${duration(d.dur || 0)}`;
  const canCall = peer && S.contacts.get(peer.id)?.state === 'ok';
  return h('div', { class: `row rich call-row ${missed ? 'missed' : ''}`, onclick: () => openConv(conv.id) },
    peer ? avatar(peer, 'list-av', statusClass(S.contacts.get(peer.id))) : h('span', { class: 'avatar group-av list-av' }),
    h('div', { class: 'two' }, h('span', { class: 'name' }, convTitle(conv)),
      h('span', { class: 'mood' }, h('span', { class: 'call-dir' }, mine ? '↗' : '↙'), ` ${d.video ? 'Video · ' : ''}${what}`)),
    h('div', { class: 'side-info' }, h('span', { class: 'when' }, shortWhen(m.at)),
      canCall ? h('button', { class: 'call-back', title: d.video ? 'Videobellen' : 'Bellen', onclick: (e) => { e.stopPropagation(); Call.start(peer.id, !!d.video); } }, svg(d.video ? 'video' : 'phone')) : null));
}

function addMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  popMenu([
    { label: 'Contactpersoon toevoegen', icon: 'user', run: () => addContactDialog() },
    { label: 'Groep maken', icon: 'chat', run: () => groupDialog() }
  ], r.right - 220, r.top - 90, { anchor });
}

function moreMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  popMenu([
    { label: 'Skitta Home', icon: 'home', run: () => { showHome(); showPaneOnMobile(true); } },
    { label: 'Online-status', sub: presenceItems() },
    { label: 'Profiel bewerken…', icon: 'user', run: profileDialog },
    { label: 'Weergave', sub: modeItems() },
    { label: 'Opties…', run: optionsDialog },
    { label: 'Geblokkeerde contactpersonen…', icon: 'block', run: blockedDialog },
    S.me.is_admin && { label: 'Beheer…', run: () => window.open('/beheer', '_blank') },
    Native.api?.checkForUpdate && { label: `Controleren op updates (versie ${Native.api.appVersion?.() || '?'})`, run: () => Native.api.checkForUpdate() },
    { label: 'Over Skitta', run: aboutDialog },
    '-',
    { label: 'Afmelden', run: logout }
  ], r.left, r.top - 300, { anchor });
}

function renderNav() {
  const nav = $('#mnav');
  if (!nav || !S.me) return;
  nav.hidden = false;
  const active = navActive();
  for (const b of nav.querySelectorAll('[data-nav]')) b.classList.toggle('on', b.dataset.nav === active);
  let unread = 0;
  for (const c of S.convs.values()) if (!c.left) unread += c.unread || 0;
  $('#mnav-count').textContent = unread ? String(unread) : '';
  glassBar();
}

// In de Android-app: de glazen balk precies over de plek van de balk in de pagina leggen.
function glassBar() {
  const api = Native.api;
  if (!api?.glassBar) return;
  const pill = $('#mnav-pill').getBoundingClientRect();
  const add = $('#mnav-add').getBoundingClientRect();
  const visible = mobile() && !!S.me && !$('#app').classList.contains('show-pane') && !$('#layer .overlay');
  const box = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  let unread = 0;
  for (const c of S.convs.values()) if (!c.left) unread += c.unread || 0;
  try {
    api.glassBar(JSON.stringify({
      pill: box(pill), add: box(add), active: navActive(), dark: document.documentElement.dataset.mode === 'dark', visible,
      tabs: [
        { id: 'recent', title: unread ? `Chats (${unread})` : 'Chats', icon: ICONS.chat },
        { id: 'contacts', title: 'Contacten', icon: ICONS.user },
        { id: 'calls', title: 'Bellen', icon: ICONS.phone },
        { id: 'more', title: 'Meer', icon: ICONS.menu }
      ]
    }));
  } catch {}
}

window.skittaGlassNav = (id) => navTo(id);
window.addEventListener('resize', () => { renderNav(); measureHead(); });

// ---------- Licht of donker (telefoon) ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyMode() {
  const pref = S.opts.mode || 'auto';
  let system = darkQuery.matches;
  try { if (Native.api?.systemDark) system = Native.api.systemDark(); } catch {}
  const dark = pref === 'dark' || (pref === 'auto' && system);
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark && mobile() ? '#121416' : '#00aff0');
  try { Native.api?.setDark?.(dark); } catch {}
  glassBar();
}
darkQuery.addEventListener?.('change', applyMode);

function setMode(mode) {
  S.opts.mode = mode;
  saveOpts();
  applyMode();
}

function modeItems() {
  return [['auto', 'Automatisch (zoals je telefoon)'], ['light', 'Licht'], ['dark', 'Donker']]
    .map(([id, label]) => ({ label, checked: (S.opts.mode || 'auto') === id, run: () => setMode(id) }));
}

// Kopje met blur: hoogte doorgeven zodat de berichten eronder beginnen.
function measureHead() {
  const head = $('#conv-head');
  if (head) $('#pane').style.setProperty('--head-h', `${head.offsetHeight}px`);
}

function setupNav() {
  if (Native.api || isStandalone()) document.documentElement.classList.add('app-mode');
  applyMode();
  for (const el of document.querySelectorAll('.mi-svg[data-icon]')) el.append(svg(el.dataset.icon));
  for (const b of document.querySelectorAll('#mnav [data-nav]')) b.onclick = () => navTo(b.dataset.nav);
  if (Native.api) document.documentElement.classList.add('native');
}

function markAllRead() {
  for (const c of S.convs.values()) if (c.unread && c.last?.id) markReadNow(c);
  updateTitle();
  renderList();
}

function markReadNow(c) {
  c.unread = 0;
  c.last_read = c.last.id;
  api('POST', `conversations/${c.id}/read`, { id: c.last.id }).catch(() => {});
}

// ---------- Dialoogvensters ----------

function dialog(title, body, buttons, opts = {}) {
  return new Promise((resolve) => {
    let overlay;
    const close = (v) => { overlay.remove(); resolve(v); };
    const foot = h('div', { class: 'dfoot' });
    for (const b of buttons) {
      if (b.left) {
        foot.querySelector('.left') || foot.prepend(h('div', { class: 'left' }));
        foot.querySelector('.left').append(h('button', { class: 'btn', type: 'button', onclick: () => b.run(close) }, b.label));
        continue;
      }
      foot.append(h('button', {
        class: `btn ${b.default ? 'default' : ''}`, type: b.default ? 'submit' : 'button',
        onclick: async (e) => {
          e.preventDefault();
          if (b.run) {
            e.currentTarget.disabled = true;
            const btn = e.currentTarget;
            try { await b.run(close); } finally { btn.disabled = false; }
          } else close(b.value);
        }
      }, b.label));
    }
    const form = h('form', { class: 'dialog', style: opts.width ? { width: `${opts.width}px` } : null, onsubmit: (e) => { e.preventDefault(); foot.querySelector('.btn.default')?.click(); } },
      h('div', { class: 'dtitle' }, h('img', { src: '/img/favicon.png', alt: '' }), title,
        opts.closable === false ? null : h('button', { class: 'dclose', type: 'button', title: 'Sluiten', onclick: () => close(undefined) }, '✕')),
      h('div', { class: 'dbody' }, body),
      buttons.length ? foot : null);
    overlay = h('div', { class: 'overlay', onpointerdown: (e) => { if (e.target === overlay && opts.dismiss !== false) close(undefined); } }, form);
    $('#layer').append(overlay);
    setTimeout(() => (form.querySelector('[autofocus]') || form.querySelector('input, textarea, select') || foot.querySelector('.btn.default'))?.focus(), 0);
  });
}

function alertDialog(title, text) {
  return dialog(title, h('p', null, text), [{ label: 'OK', default: true, value: true }]);
}

function confirmDialog(title, text, ok = 'OK') {
  return dialog(title, h('p', null, text), [{ label: ok, default: true, value: true }, { label: 'Annuleren', value: false }]);
}

async function addContactDialog(prefill = '') {
  const input = h('input', { class: 'field', value: prefill, placeholder: 'Naam, Skittanaam of e-mailadres', autofocus: true });
  const results = h('div', { class: 'results', hidden: true });
  const err = h('div', { class: 'err' });
  let timer;
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    try {
      const list = await api('GET', `users/search?q=${encodeURIComponent(q)}`);
      results.hidden = false;
      results.replaceChildren(...(list.length ? list.map((u) => {
        const c = S.contacts.get(u.id);
        const state = c?.state;
        const action = state === 'ok' ? h('button', { class: 'btn', type: 'button', onclick: () => { closeLayer(); openContact(u.id); } }, 'Chatten')
          : state === 'out' ? h('span', { class: 'muted' }, 'Verzoek verstuurd')
            : state === 'in' ? h('button', { class: 'btn default', type: 'button', onclick: async () => { await acceptContact(u.id); search(); } }, 'Accepteren')
              : h('button', { class: 'btn', type: 'button', onclick: () => requestDialog(u) }, 'Toevoegen');
        return h('div', { class: 'res' }, avatar(u), h('div', { class: 'grow' }, h('div', null, h('b', null, u.display_name), ` (${u.username})`), h('div', null, u.mood)), action);
      }) : [h('div', { class: 'res muted' }, 'Niemand gevonden.')]));
    } catch (e) {
      err.textContent = e.message;
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  if (prefill) setTimeout(search, 0);
  await dialog('Contactpersoon toevoegen', h('div', null,
    h('h3', null, 'Zoek naar mensen op Skitta'),
    h('div', { class: 'frow' }, input), results, err), [{ label: 'Sluiten', value: null }], { width: 460 });
}

async function requestDialog(u) {
  const msg = h('textarea', { class: 'field', rows: 4, maxlength: 300 }, `Hallo ${u.display_name.split(' ')[0]}, ik wil je graag toevoegen aan mijn lijst met contactpersonen.`);
  const err = h('div', { class: 'err' });
  await dialog('Contactverzoek versturen', h('div', null,
    h('div', { class: 'profile-top' }, avatar(u, 'lg'), h('div', { class: 'grow' }, h('div', { class: 'nm' }, u.display_name), h('div', { class: 'muted' }, u.username))),
    h('div', { class: 'frow' }, h('label', null, 'Stel jezelf voor:'), msg), err),
  [{
    label: 'Verzenden', default: true, run: async (close) => {
      try {
        const r = await api('POST', 'contacts', { user_id: u.id, message: msg.value });
        await loadContacts();
        renderList();
        close(true);
        closeLayer();
        toast({ user: u, title: u.display_name, text: r.state === 'ok' ? 'is nu een contactpersoon' : 'Contactverzoek verstuurd', plain: true });
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }, { label: 'Annuleren', value: null }]);
}

async function sendRequest(id) {
  try {
    await api('POST', 'contacts', { user_id: id });
    toast({ title: 'Contactverzoek', text: 'Het verzoek is opnieuw verstuurd', plain: true });
  } catch (e) {
    toastError(e.message);
  }
}

async function acceptContact(id) {
  try {
    await api('POST', `contacts/${id}/accept`);
    await loadContacts();
    Sound.play('USER_ADDED');
    renderList();
    openContact(id);
  } catch (e) {
    toastError(e.message);
  }
}

async function removeContact(id, decline = false) {
  try {
    await api('DELETE', `contacts/${id}`);
    await loadContacts();
    if (S.cur === `u${id}`) showHome();
    renderList();
    renderPane();
    if (!decline) toast({ title: 'Contactpersonen', text: 'Verwijderd uit je contactpersonen', plain: true });
  } catch (e) {
    toastError(e.message);
  }
}

async function confirmRemove(c) {
  if (await confirmDialog('Contactpersoon verwijderen', `Weet je zeker dat je ${c.display_name} wilt verwijderen uit je lijst met contactpersonen?`, 'Verwijderen')) removeContact(c.id);
}

async function blockContact(id) {
  const c = S.contacts.get(id) || userOf(id);
  if (!(await confirmDialog('Blokkeren', `Wil je ${c.display_name} blokkeren? Deze persoon kan je dan geen berichten of verzoeken meer sturen en je niet meer bellen.`, 'Blokkeren'))) return;
  try {
    await api('POST', `contacts/${id}/block`);
    await loadContacts();
    if (S.cur === `u${id}` || directConvWith(id)?.id === S.cur) showHome();
    renderList();
  } catch (e) {
    toastError(e.message);
  }
}

async function unblockContact(id) {
  try {
    await api('DELETE', `contacts/${id}/block`);
    await loadContacts();
    renderList();
    renderPane();
  } catch (e) {
    toastError(e.message);
  }
}

async function blockedDialog() {
  const list = [...S.contacts.values()].filter((c) => c.state === 'blocked');
  const body = h('div', null, h('p', null, 'Geblokkeerde personen kunnen je geen berichten of verzoeken sturen en je niet bellen.'),
    h('div', { class: 'results' }, list.length ? list.map((c) => h('div', { class: 'res' }, avatar(c), h('div', { class: 'grow' }, h('div', null, c.display_name), h('div', null, c.username)),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => { await unblockContact(c.id); e.target.closest('.res').remove(); } }, 'Deblokkeren'))) : h('div', { class: 'res muted' }, 'Je hebt niemand geblokkeerd.')));
  await dialog('Geblokkeerde contactpersonen', body, [{ label: 'Sluiten', default: true, value: null }]);
}

function contactProfile(c) {
  const full = S.contacts.get(c.id) || c;
  dialog(`Profiel van ${full.display_name}`, h('div', null,
    h('div', { class: 'profile-top' }, avatar(full, 'xl'),
      h('div', { class: 'grow' },
        h('div', { class: 'nm' }, h('span', { class: `st ${statusClass(full)}`, style: { verticalAlign: '-2px', marginRight: '5px' } }), full.display_name),
        h('div', { class: 'muted' }, `Skittanaam: ${full.username}`),
        full.mood ? h('p', { style: { marginTop: '8px' } }, full.mood) : null,
        h('div', { class: 'muted' }, statusLine(S.contacts.get(full.id)))))),
  [
    S.contacts.get(full.id)?.state === 'ok' && { label: 'Bericht sturen', run: (close) => { close(); openContact(full.id); } },
    { label: 'Sluiten', default: true, value: null }
  ].filter(Boolean));
}

async function profileDialog() {
  const me = S.me;
  const name = h('input', { class: 'field', value: me.display_name, maxlength: 60 });
  const mood = h('input', { class: 'field', value: me.mood || '', maxlength: 200, placeholder: 'Vertel je contactpersonen wat je aan het doen bent' });
  const email = h('input', { class: 'field', type: 'email', value: me.email });
  const err = h('div', { class: 'err' });
  const av = avatar(me, 'xl');
  const file = h('input', {
    type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const img = await squareImage(f);
        const r = await api('PUT', 'me/avatar', img);
        me.avatar = r.avatar;
        av.className = 'avatar xl';
        av.style.backgroundImage = `url("/api/media/${r.avatar}")`;
        renderMe();
      } catch (e) {
        err.textContent = e.message;
      }
    }
  });
  await dialog('Profiel bewerken', h('div', null,
    h('div', { class: 'profile-top' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' } }, av,
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Foto wijzigen…'),
        h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('DELETE', 'me/avatar'); me.avatar = null; av.className = 'avatar xl none'; av.style.backgroundImage = ''; renderMe(); } }, 'Foto verwijderen'), file),
      h('div', { class: 'grow' },
        h('div', { class: 'frow' }, h('label', null, 'Skittanaam'), h('b', null, me.username)),
        h('div', { class: 'frow' }, h('label', null, 'Volledige naam'), name),
        h('div', { class: 'frow' }, h('label', null, 'Stemmingsbericht'), mood),
        h('div', { class: 'frow' }, h('label', null, 'E-mailadres (alleen zichtbaar voor jou)'), email))),
    err),
  [{
    label: 'Opslaan', default: true, run: async (close) => {
      try {
        await api('PATCH', 'me', { display_name: name.value, mood: mood.value, email: email.value });
        Object.assign(me, { display_name: name.value.trim(), mood: mood.value.trim(), email: email.value.trim() });
        renderMe();
        close(true);
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }, { label: 'Annuleren', value: null }], { width: 500 });
}

// Profielfoto: vierkant bijsnijden naar 256 px.
async function squareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - size) / 2, (bmp.height - size) / 2, size, size, 0, 0, 256, 256);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
}

async function passwordDialog() {
  const cur = h('input', { class: 'field', type: 'password', autocomplete: 'current-password' });
  const pw = h('input', { class: 'field', type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'field', type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'err' });
  await dialog('Wachtwoord wijzigen', h('div', null,
    h('div', { class: 'frow' }, h('label', null, 'Huidig wachtwoord'), cur),
    h('div', { class: 'frow' }, h('label', null, 'Nieuw wachtwoord (minimaal 8 tekens)'), pw),
    h('div', { class: 'frow' }, h('label', null, 'Nieuw wachtwoord herhalen'), pw2), err),
  [{
    label: 'Wijzigen', default: true, run: async (close) => {
      if (pw.value !== pw2.value) { err.textContent = 'De nieuwe wachtwoorden zijn niet hetzelfde'; return; }
      if (pw.value.length < 8) { err.textContent = 'Wachtwoord moet minimaal 8 tekens zijn'; return; }
      try {
        await E2E.changePassword(S.me, cur.value, pw.value);
        close(true);
        toast({ title: 'Wachtwoord', text: 'Je wachtwoord is gewijzigd', plain: true });
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }, { label: 'Annuleren', value: null }]);
}

function pickContacts(preselected = [], exclude = []) {
  const list = [...S.contacts.values()].filter((c) => c.state === 'ok' && !exclude.includes(c.id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'nl'));
  const box = h('div', { class: 'pick-list' }, list.length ? list.map((c) => h('label', null,
    h('input', { type: 'checkbox', value: c.id, checked: preselected.includes(c.id) }), h('span', { class: `st ${statusClass(c)}` }), c.display_name,
    h('span', { class: 'muted' }, ` (${c.username})`))) : h('div', { class: 'muted', style: { padding: '8px' } }, 'Geen contactpersonen om toe te voegen.'));
  box.selected = () => [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));
  return box;
}

async function groupDialog(preselected = []) {
  const topic = h('input', { class: 'field', maxlength: 100, placeholder: 'Bijvoorbeeld: Vrijdagavond' });
  const pick = pickContacts(preselected);
  const err = h('div', { class: 'err' });
  await dialog('Groep maken', h('div', null,
    h('div', { class: 'frow' }, h('label', null, 'Onderwerp (mag leeg blijven)'), topic),
    h('div', { class: 'frow' }, h('label', null, 'Kies de contactpersonen voor dit groepsgesprek:'), pick), err),
  [{
    label: 'Groep maken', default: true, run: async (close) => {
      const ids = pick.selected();
      if (!ids.length) { err.textContent = 'Kies minstens één contactpersoon'; return; }
      try {
        const conv = await api('POST', 'conversations', { user_ids: ids, topic: topic.value });
        S.convs.set(conv.id, conv);
        close(true);
        openConv(conv.id);
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }, { label: 'Annuleren', value: null }]);
}

async function addPeopleDialog(conv) {
  const pick = pickContacts([], conv.members.filter((m) => !m.left).map((m) => m.id));
  const err = h('div', { class: 'err' });
  await dialog('Personen toevoegen', h('div', null, h('div', { class: 'frow' }, h('label', null, `Toevoegen aan "${convTitle(conv)}":`), pick), err),
    [{
      label: 'Toevoegen', default: true, run: async (close) => {
        const ids = pick.selected();
        if (!ids.length) return close(null);
        try {
          await api('POST', `conversations/${conv.id}/members`, { user_ids: ids });
          await loadConvs();
          renderPane();
          close(true);
        } catch (e) {
          err.textContent = e.message;
        }
      }
    }, { label: 'Annuleren', value: null }]);
}

async function topicDialog(conv) {
  const input = h('input', { class: 'field', maxlength: 100, value: conv.topic });
  const err = h('div', { class: 'err' });
  await dialog('Onderwerp wijzigen', h('div', null, h('div', { class: 'frow' }, h('label', null, 'Onderwerp van dit gesprek'), input), err),
    [{
      label: 'Opslaan', default: true, run: async (close) => {
        try {
          await api('PATCH', `conversations/${conv.id}`, { topic: input.value });
          conv.topic = input.value.trim();
          renderHead();
          renderList();
          close(true);
        } catch (e) {
          err.textContent = e.message;
        }
      }
    }, { label: 'Annuleren', value: null }]);
}

async function leaveConv(conv) {
  if (!(await confirmDialog('Gesprek verlaten', `Wil je "${convTitle(conv)}" verlaten? Je krijgt dan geen berichten meer uit dit gesprek.`, 'Verlaten'))) return;
  try {
    await api('DELETE', `conversations/${conv.id}/members/me`);
    await loadConvs();
    renderList();
    renderPane();
  } catch (e) {
    toastError(e.message);
  }
}

async function reportDialog(m) {
  const reasons = [['spam', 'Spam of reclame'], ['intimidatie', 'Pesten, bedreigen of intimidatie'], ['ongepast', 'Ongepaste of aanstootgevende inhoud'], ['nep', 'Oplichting of nepaccount'], ['anders', 'Iets anders']];
  const radios = reasons.map(([v, label], i) => h('label', null, h('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), label));
  const note = h('textarea', { class: 'field', rows: 3, maxlength: 500, placeholder: 'Toelichting (optioneel)' });
  const err = h('div', { class: 'err' });
  await dialog('Bericht melden', h('div', null,
    h('p', null, `Je meldt dit bericht van ${nameOf(m.u)} bij de beheerder van Skitta. Daarvoor wordt alleen dit ene bericht leesbaar gemaakt voor de beheerder; de rest van het gesprek blijft versleuteld.`),
    h('div', { class: 'bubble', style: { padding: '8px', background: '#f3f9fd', border: '1px solid #cfe2ee', borderRadius: '4px', marginBottom: '10px', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' } }, previewText(m)),
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Waarom meld je dit bericht?'), radios),
    note, err),
  [{
    label: 'Melden', default: true, run: async (close) => {
      try {
        const reason = radios.map((r) => r.querySelector('input')).find((i) => i.checked)?.value;
        await api('POST', `messages/${m.id}/report`, { reason, note: note.value, key: m.mk });
        close(true);
        alertDialog('Bedankt voor je melding', 'De beheerder bekijkt het bericht en beslist of het mag blijven staan.');
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }, { label: 'Annuleren', value: null }], { width: 460 });
}

async function optionsDialog() {
  const o = S.opts;
  const cb = (key, label, def = false) => {
    const input = h('input', { type: 'checkbox', checked: o[key] ?? def });
    input.onchange = () => { o[key] = input.checked; saveOpts(); };
    return h('label', null, input, label);
  };
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: o.volume });
  vol.oninput = () => { o.volume = Number(vol.value); saveOpts(); };
  vol.onchange = () => Sound.play('IM', { force: true });
  const notif = h('input', { type: 'checkbox', disabled: !!Native.api });
  Push.state().then((st) => { notif.checked = Native.api ? true : st === 'on'; });
  notif.onchange = async () => {
    try {
      if (notif.checked) await Push.enable();
      else await Push.disable();
      o.notifications = notif.checked;
      saveOpts();
    } catch (e) {
      notif.checked = false;
      toastError(e.message);
    }
  };
  const sample = (name) => h('button', { class: 'btn', type: 'button', style: { minWidth: '0' }, onclick: () => Sound.play(name, { force: true }) }, '▶');
  await dialog('Opties', h('div', null,
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Geluiden'),
      cb('sounds', 'Geluiden afspelen', true),
      cb('classic', 'Klassieke geluiden (de allereerste versie)'),
      cb('onlineSounds', 'Geluid als een contactpersoon online of offline gaat', true),
      cb('sentSound', 'Geluid bij het versturen van een bericht'),
      h('label', null, 'Volume ', vol),
      h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' } }, 'Proberen:',
        [['IM', 'Bericht'], ['CALL_IN', 'Oproep'], ['ONLINE', 'Online'], ['LOGIN', 'Aanmelden'], ['HANGUP', 'Ophangen']].map(([n, l]) => h('span', null, sample(n), ' ', l, ' ')))),
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Meldingen'),
      Native.api?.hideConnection ? h('label', null, h('button', { class: 'btn', type: 'button', onclick: () => Native.api.hideConnection() }, 'Melding "Skitta is verbonden" verbergen…')) : null,
    Native.api?.setBackground ? (() => {
        const bg = h('input', { type: 'checkbox', checked: Native.api.background() });
        bg.onchange = () => Native.api.setBackground(bg.checked);
        return h('label', null, bg, 'Verbonden blijven op de achtergrond (meldingen als de app dicht is)');
      })() : h('label', null, notif, Native.api ? 'Meldingen regelt de app zelf' : 'Pushmeldingen op dit apparaat (ook als Skitta dicht is)'),
      isIos() && !isStandalone() ? h('p', { class: 'muted', style: { margin: '0 0 6px' } }, 'Op een iPhone werkt dit alleen als je Skitta op je beginscherm zet (Deel → Zet op beginscherm).') : null,
      cb('onlineToasts', 'Melding als een contactpersoon online komt')),
    mobile() ? h('fieldset', { class: 'opt-group' }, h('legend', null, 'Weergave'),
      [['auto', 'Automatisch (zoals je telefoon)'], ['light', 'Licht'], ['dark', 'Donker']].map(([id, label]) => h('label', null,
        h('input', { type: 'radio', name: 'mode', checked: (o.mode || 'auto') === id, onchange: () => setMode(id) }), label))) : null,
    mobile() ? null : h('fieldset', { class: 'opt-group' }, h('legend', null, 'Versie (uiterlijk)'),
      h('div', { class: 'theme-pick' }, THEMES.map(([id, label]) => h('label', null,
        h('input', { type: 'radio', name: 'theme', checked: (o.theme || '') === id, onchange: () => setTheme(id) }), label)))),
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Privacy'),
      (() => {
        const rr = h('input', { type: 'checkbox', checked: S.me.read_receipts !== false });
        rr.onchange = async () => { S.me.read_receipts = rr.checked; try { await api('PATCH', 'me', { read_receipts: rr.checked }); } catch (e) { toastError(e.message); } };
        return h('label', null, rr, 'Leesbevestigingen delen (uit = je ziet ze ook niet van anderen)');
      })(),
      cb('typing', 'Laten zien dat ik aan het typen ben', true),
      cb('relay', 'Gesprekken altijd via de server laten lopen (verbergt je IP-adres voor de ander)'),
      Native.api?.setSecure ? (() => {
        const sc = h('input', { type: 'checkbox', checked: Native.api.secure() });
        sc.onchange = () => Native.api.setSecure(sc.checked);
        return h('label', null, sc, 'Schermbeveiliging: geen schermafbeeldingen en verborgen in recente apps');
      })() : null,
      Native.api?.setLock ? (() => {
        const lk = h('input', { type: 'checkbox', checked: Native.api.lock() });
        lk.onchange = () => Native.api.setLock(lk.checked);
        return h('label', null, lk, 'Schermvergrendeling: ontgrendelen met vingerafdruk of pincode');
      })() : null),
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Chatten'),
      cb('enterSends', 'Enter verstuurt het bericht (Shift+Enter voor een nieuwe regel)', true))),
  [{ label: 'OK', default: true, value: true }], { width: 480 });
  Sound.cache.clear();
}

function shortcutsDialog() {
  const rows = [['Enter', 'Bericht versturen'], ['Shift+Enter', 'Nieuwe regel'], ['↑ (leeg invoerveld)', 'Laatste bericht bewerken'], ['Esc', 'Bewerken annuleren, venster sluiten'], ['Rechtermuisknop', 'Menu bij een bericht of contactpersoon'], ['Ctrl+V', 'Foto plakken en versturen']];
  dialog('Sneltoetsen', h('table', { style: { borderCollapse: 'collapse', width: '100%' } }, rows.map(([k, v]) => h('tr', null, h('td', { style: { padding: '3px 12px 3px 0', whiteSpace: 'nowrap' } }, h('b', null, k)), h('td', null, v)))),
    [{ label: 'OK', default: true, value: true }]);
}

function aboutDialog() {
  dialog('Over Skitta', h('div', { style: { textAlign: 'center' } },
    h('img', { src: '/img/icon-192.png', alt: '', style: { width: '80px', height: '80px' } }),
    h('h3', { style: { margin: '6px 0' } }, 'Skitta'),
    h('p', null, 'Chatten, bellen en videobellen met je vrienden, zoals vroeger.'),
    h('p', { class: 'muted' }, 'skitta.timvanbergen.nl')),
  [{ label: 'OK', default: true, value: true }]);
}

async function testDialog() {
  const video = h('video', { autoplay: true, muted: true, playsinline: true, style: { width: '100%', background: '#000', borderRadius: '3px', transform: 'scaleX(-1)' } });
  const meter = h('div', { style: { height: '8px', background: '#e3e3e3', borderRadius: '4px', overflow: 'hidden', marginTop: '8px' } }, h('div', { style: { height: '100%', width: '0', background: 'linear-gradient(90deg,#7ccb2c,#f0c400,#e8423a)' } }));
  const err = h('div', { class: 'err' });
  let stream;
  let raf;
  setTimeout(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      video.srcObject = stream;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        meter.firstChild.style.width = `${Math.min(100, peak * 1.6)}%`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      err.textContent = 'Geen toegang tot de camera of microfoon. Sta dit toe in je browser.';
    }
  }, 0);
  await dialog('Geluid en video testen', h('div', null, video, meter, h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Praat even: de balk moet bewegen.'), err,
    h('button', { class: 'btn', type: 'button', onclick: () => Sound.play('CALL_IN', { force: true }) }, 'Beltoon afspelen')),
  [{ label: 'Sluiten', default: true, value: true }], { width: 420 });
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
}

// ---------- Galerij: horizontaal door alle foto's en video's van een gesprek ----------
// Vegen (telefoon), pijltjestoetsen of de pijlknoppen (computer). Video's: in de Android-app de
// eigen videospeler van Android, elders de speler van het systeem (WebView2 / WebKit / browser).

const Gallery = {
  items: [],
  index: 0,
  el: null,

  collect(convId) {
    return bucket(convId).list.filter((m) => {
      if (m.k !== 'photo' || m.del || m.rm || m.locked) return false;
      const meta = attachMeta(m);
      if (!['photo', 'video'].includes(meta?.t)) return false;
      if (meta.big && meta.until && meta.until < Date.now() && !m.localUrl) return false;
      return !!(m.media || m.localUrl || meta.big);
    });
  },

  open(m) {
    this.close();
    this.items = this.collect(m.c);
    this.index = Math.max(0, this.items.findIndex((x) => x === m || (x.id && x.id === m.id) || (x.cid && x.cid === m.cid)));
    const track = h('div', { class: 'g-track' }, this.items.map((it, i) => h('div', { class: 'g-slide', 'data-i': i })));
    const counter = h('span', { class: 'g-count' });
    const info = h('div', { class: 'g-info' });
    this.el = h('div', { class: 'gallery', tabindex: -1 },
      h('div', { class: 'g-top' },
        h('button', { class: 'g-btn', title: 'Sluiten (Esc)', onclick: () => this.close() }, svg('close')),
        info, counter,
        h('button', { class: 'g-btn', title: 'Opslaan', onclick: () => this.save() }, svg('download')),
        h('button', { class: 'g-btn', title: 'Doorsturen', onclick: () => { const it = this.items[this.index]; this.close(); forwardDialog(it); } }, svg('back'))),
      track,
      h('button', { class: 'g-nav g-prev', title: 'Vorige', onclick: () => this.go(this.index - 1) }, svg('left')),
      h('button', { class: 'g-nav g-next', title: 'Volgende', onclick: () => this.go(this.index + 1) }, svg('right')));
    this.track = track;
    this.counter = counter;
    this.info = info;
    document.body.append(this.el);
    this.el.focus();
    // Pas laden als een dia (bijna) in beeld komt.
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.load(Number(e.target.dataset.i));
    }, { root: track, rootMargin: '0px 100% 0px 100%' });
    for (const s of track.children) this.observer.observe(s);
    requestAnimationFrame(() => {
      track.scrollLeft = this.index * track.clientWidth;
      this.update();
    });
    let t;
    track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => this.update(), 80); }, { passive: true });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.go(this.index - 1);
      else if (e.key === 'ArrowRight') this.go(this.index + 1);
      else if (e.key === 'Escape') this.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.backHook = window.skittaBack;
    window.skittaBack = () => { this.close(); return true; };
  },

  go(i) {
    if (i < 0 || i >= this.items.length) return;
    this.track.scrollTo({ left: i * this.track.clientWidth, behavior: 'smooth' });
  },

  update() {
    const i = Math.round(this.track.scrollLeft / Math.max(1, this.track.clientWidth));
    this.index = Math.min(this.items.length - 1, Math.max(0, i));
    const it = this.items[this.index];
    if (!it) return;
    this.counter.textContent = `${this.index + 1} / ${this.items.length}`;
    this.info.replaceChildren(h('b', null, it.u === S.me.id ? 'Jij' : nameOf(it.u)), h('span', null, new Date(it.at).toLocaleString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })));
    this.el.querySelector('.g-prev').hidden = this.index === 0;
    this.el.querySelector('.g-next').hidden = this.index === this.items.length - 1;
    // Video's die uit beeld zijn: pauzeren.
    for (const v of this.track.querySelectorAll('video')) {
      if (Number(v.closest('.g-slide').dataset.i) !== this.index) v.pause();
      else if (v.paused && !v.dataset.started) { v.dataset.started = '1'; v.play().catch(() => {}); }
    }
  },

  async load(i) {
    const slide = this.track.children[i];
    if (!slide || slide.dataset.loaded) return;
    slide.dataset.loaded = '1';
    const m = this.items[i];
    const meta = attachMeta(m);
    if (meta.t === 'video' && Native.api?.videoPlay) {
      // Android: voorbeeld met afspeelknop; afspelen in de eigen videospeler.
      slide.append(h('button', { class: 'g-vstart', onclick: () => this.playNative(m, meta, slide) },
        meta.thumb ? h('img', { src: meta.thumb, alt: '' }) : null, h('span', { class: 'vplay big' }, svg('play')),
        h('span', { class: 'g-vinfo' }, [meta.dur ? duration(meta.dur) : '', meta.size ? fileSize(meta.size) : ''].filter(Boolean).join(' · '))));
      return;
    }
    slide.append(h('div', { class: 'g-loading' }, meta.t === 'video' ? 'Video laden…' : ''));
    const url = await mediaUrl(m, meta);
    slide.replaceChildren();
    if (!url) { slide.append(h('div', { class: 'g-loading' }, 'Kon niet worden geladen')); return; }
    if (meta.t === 'video') {
      const v = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata', poster: meta.thumb || null });
      slide.append(v);
      if (i === this.index) { v.dataset.started = '1'; v.play().catch(() => {}); }
    } else {
      const img = h('img', { src: url, alt: '', draggable: 'false' });
      // Dubbelklikken of dubbeltikken: inzoomen.
      img.addEventListener('dblclick', (e) => {
        const on = slide.classList.toggle('zoomed');
        if (on) {
          const r = img.getBoundingClientRect();
          requestAnimationFrame(() => slide.scrollTo((e.clientX - r.left) * 2 - slide.clientWidth / 2, (e.clientY - r.top) * 2 - slide.clientHeight / 2));
        }
      });
      slide.append(img);
    }
  },

  // Android: de ontsleutelde video in stukjes naar de app sturen en daar afspelen.
  async playNative(m, meta, slide) {
    const btn = slide.querySelector('.g-vinfo');
    const url = await mediaUrl(m, meta);
    if (!url) return toastError('Deze video kon niet worden geladen');
    const blob = await (await fetch(url)).blob();
    const id = String(m.id || m.cid);
    Native.api.videoBegin(id);
    const PART = 1536 * 1024;
    for (let off = 0; off < blob.size; off += PART) {
      const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob.slice(off, off + PART)); });
      Native.api.videoChunk(id, b64);
      if (btn) btn.textContent = `Voorbereiden… ${Math.round(((off + PART) / blob.size) * 100)}%`;
    }
    if (btn) btn.textContent = [meta.dur ? duration(meta.dur) : '', meta.size ? fileSize(meta.size) : ''].filter(Boolean).join(' · ');
    Native.api.videoPlay(id, meta.mime || blob.type || 'video/mp4', meta.name || 'Video');
  },

  async save() {
    const m = this.items[this.index];
    if (!m) return;
    const meta = attachMeta(m);
    const url = await mediaUrl(m, meta);
    if (!url) return;
    const name = meta.name || (meta.t === 'video' ? 'video.mp4' : 'foto.jpg');
    if (Native.api?.save) {
      const blob = await (await fetch(url)).blob();
      const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      Native.api.save(name, meta.mime || blob.type, data);
      return;
    }
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
  },

  close() {
    if (!this.el) return;
    for (const v of this.el.querySelectorAll('video')) v.pause();
    this.observer?.disconnect();
    this.el.remove();
    this.el = null;
    if (this.backHook) window.skittaBack = this.backHook;
  }
};

function lightbox(src) {
  const box = h('div', { class: 'lightbox', onclick: () => box.remove() },
    h('img', { src, alt: '' }),
    h('a', { href: src, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Origineel openen'));
  $('#layer').append(box);
}

// ---------- Meldingen rechtsonder ----------

function toast({ user, title, text, onclick, plain, kind = '', ms = 6000 }) {
  const t = h('div', {
    class: `toast ${plain || !onclick ? 'plain' : ''} ${kind}`,
    onclick: () => { t.remove(); onclick?.(); }
  }, user ? avatar(user) : h('img', { src: '/img/favicon.png', alt: '', style: { width: '32px', height: '32px' } }),
  h('div', { class: 'grow' }, h('div', { class: 't1' }, title), h('div', { class: 't2' }, text)));
  $('#toasts').append(t);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

function toastError(text) {
  toast({ title: 'Skitta', text, kind: 'error', plain: true });
}

// ---------- Meldingen: native apps, Web Push en meldingen terwijl Skitta open is ----------
// In de Android- en desktop-apps bestaat window.SkittaNative (notify, badge, platform).

const Native = {
  get api() { return window.SkittaNative || null; },
  notify(title, body, c = 0, kind = 'msg') {
    if (!this.api) return false;
    try { this.api.notify(String(title), String(body), String(c || 0), kind); return true; } catch { return false; }
  },
  badge(n) {
    try { this.api?.badge(Number(n) || 0); } catch {}
  },
  platform() {
    try { return this.api?.platform() || ''; } catch { return ''; }
  }
};

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function urlB64(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const Push = {
  supported() {
    return !Native.api && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  async registration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      await navigator.serviceWorker.register('/sw.js');
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  },
  async state() {
    if (!this.supported()) return 'unsupported';
    const reg = await this.registration();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (sub && Notification.permission === 'granted') return 'on';
    return Notification.permission === 'denied' ? 'denied' : 'off';
  },
  async enable() {
    if (!this.supported()) {
      throw new Error(isIos() && !isStandalone()
        ? 'Zet Skitta eerst op je beginscherm (Deel-knop → "Zet op beginscherm") en open het daarvandaan.'
        : 'Deze browser ondersteunt geen pushmeldingen.');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Je hebt meldingen niet toegestaan. Zet ze aan in de instellingen van je browser.');
    const reg = await this.registration();
    if (!reg) throw new Error('Meldingen konden niet worden aangezet');
    const { key } = await api('GET', 'push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
    await api('POST', 'push', sub.toJSON());
  },
  async disable() {
    const reg = await this.registration();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (!sub) return;
    await api('DELETE', 'push', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  },
  // Bij het opstarten: een bestaand abonnement aan dit account koppelen.
  async sync() {
    if (!this.supported() || Notification.permission !== 'granted') return;
    const reg = await this.registration();
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (sub) api('POST', 'push', sub.toJSON()).catch(() => {});
  }
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.t === 'open' && e.data.c && S.convs.has(Number(e.data.c))) openConv(Number(e.data.c));
  });
}

// Een melding tonen terwijl Skitta open is (maar niet in beeld).
async function showLocal(title, body, c, kind = 'msg') {
  if (Native.notify(title, body, c, kind)) return;
  if (!S.opts.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, icon: '/img/icon-192.png', badge: '/img/badge.png', tag: kind === 'call' ? 'call' : `c${c}`, data: { c }, requireInteraction: kind === 'call' };
  try {
    const reg = await Push.registration();
    if (reg) return reg.showNotification(title, options);
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); if (c) openConv(c); n.close(); };
  } catch {}
}

function pushCard() {
  const card = h('div', { class: 'card', hidden: true }, h('h2', null, 'Meldingen'));
  const body = h('div', { class: 'card-body' });
  card.append(body);
  (async () => {
    if (Native.api) return;
    const st = await Push.state();
    if (st === 'on') return;
    if (isIos() && !isStandalone()) {
      body.append(h('p', { style: { margin: 0 } }, 'Wil je meldingen op je iPhone? Tik op de Deel-knop en kies ', h('b', null, 'Zet op beginscherm'), '. Open Skitta daarna vanaf je beginscherm en zet hier meldingen aan.'));
    } else if (st === 'unsupported') {
      return;
    } else if (st === 'denied') {
      body.append(h('p', { style: { margin: 0 } }, 'Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je browser voor skitta.timvanbergen.nl.'));
    } else {
      body.append(h('p', { style: { margin: '0 0 8px' } }, 'Krijg een melding bij nieuwe berichten en oproepen, ook als Skitta dicht is.'),
        h('button', { class: 'btn default', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await Push.enable();
            S.opts.notifications = true;
            saveOpts();
            card.remove();
            toast({ title: 'Meldingen', text: 'Pushmeldingen staan aan op dit apparaat', plain: true });
          } catch (err) {
            e.target.disabled = false;
            toastError(err.message);
          }
        } }, 'Meldingen aanzetten'));
    }
    card.hidden = false;
  })();
  return card;
}

// ---------- Bellen (WebRTC, één-op-één) ----------
// Signalen gaan via de Hub: ring → accept (van één apparaat) → offer/answer/ice → hangup.
// Audio en video krijgen allebei vanaf het begin een transceiver, zodat video aan/uit zetten
// zonder nieuwe onderhandeling kan (replaceTrack).

const Call = {
  active: null,
  incoming: null,
  muted: false,
  ice: null,
  lastMissedNotice: null,
  ended: new Set(),

  async iceServers() {
    if (!this.ice || this.ice.at < Date.now() - 3600e3) {
      try { this.ice = { list: await api('GET', 'ice'), at: Date.now() }; } catch { return [{ urls: 'stun:stun.cloudflare.com:3478' }]; }
    }
    return this.ice.list;
  },

  // Signalen die de verbinding opzetten (offer/answer/ICE) gaan versleuteld met de gesprekssleutel,
  // zodat ook de server geen eigen verbinding tussen jullie kan schuiven. Een wachtrij houdt de volgorde.
  sendQueue: Promise.resolve(),
  signal(to, d, dev) {
    const conv = this.active?.conv || this.incoming?.conv;
    this.sendQueue = this.sendQueue.then(async () => {
      let out = d;
      if (conv && ['offer', 'answer', 'ice', 'media'].includes(d.type)) {
        const { type, id, ...rest } = d;
        try { out = { type, id, enc: (await E2E.encrypt(conv, JSON.stringify(rest))).body }; } catch { return; }
      }
      Live.send({ t: 'call', to, dev, d: out });
    });
    return true;
  },

  async media(video) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      // Zo hoog mogelijk opnemen; bij een slechte verbinding schaalt adaptQuality het omlaag.
      video: video ? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' } : false
    });
  },

  async start(peer, video) {
    if (this.active || this.incoming) return toastError('Je bent al in gesprek');
    const contact = S.contacts.get(peer);
    if (contact?.state !== 'ok') return;
    if (!S.ws || S.ws.readyState !== 1) return toastError('Geen verbinding met Skitta');
    let conv = directConvWith(peer);
    if (!conv) {
      try {
        conv = await api('POST', 'conversations', { user_id: peer });
        S.convs.set(conv.id, conv);
      } catch (e) {
        return toastError(e.message);
      }
    }
    let stream;
    try {
      stream = await this.media(video);
    } catch {
      Sound.play('CALL_ERROR1', { force: true });
      return alertDialog('Bellen', 'Skitta kan je microfoon' + (video ? ' of camera' : '') + ' niet gebruiken. Sta dit toe in je browser en probeer het opnieuw.');
    }
    this.active = {
      id: uid(), peer, conv: conv.id, dir: 'out', video, local: stream, state: 'ringing',
      remote: new MediaStream(), remoteVideo: false, started: 0, peerDev: null, pendingIce: []
    };
    this.muted = false;
    openConv(conv.id);
    Sound.play('CALL_INIT', { force: true });
    setTimeout(() => { if (this.active?.state === 'ringing') Sound.play('CALL_OUT', { loop: true, force: true }); }, 1200);
    const ring = { type: 'ring', id: this.active.id, video, conv: conv.id };
    this.signal(peer, ring);
    // Belsignaal herhalen: wie de app opent na een pushmelding, krijgt de oproep alsnog binnen.
    const c0 = this.active;
    c0.reRing = setInterval(() => { if (this.active === c0 && c0.state === 'ringing') this.signal(peer, ring); else clearInterval(c0.reRing); }, 4000);
    this.active.timeout = setTimeout(() => {
      if (this.active?.state === 'ringing') {
        this.signal(peer, { type: 'cancel', id: this.active.id });
        this.end('noanswer');
      }
    }, 45000);
    this.refresh();
  },

  async accept(withVideo) {
    const inc = this.incoming;
    if (!inc) return;
    this.dismissIncoming();
    let stream;
    try {
      stream = await this.media(withVideo);
    } catch {
      this.signal(inc.from, { type: 'decline', id: inc.id }, inc.dev);
      Sound.play('CALL_ERROR1', { force: true });
      return alertDialog('Bellen', 'Skitta kan je microfoon niet gebruiken. Sta dit toe in je browser.');
    }
    this.active = {
      id: inc.id, peer: inc.from, conv: inc.conv, dir: 'in', video: withVideo, local: stream, state: 'connecting',
      remote: new MediaStream(), remoteVideo: false, started: 0, peerDev: inc.dev, pendingIce: []
    };
    this.muted = false;
    this.signal(inc.from, { type: 'accept', id: inc.id }, inc.dev);
    this.signal(S.me.id, { type: 'taken', id: inc.id });
    await this.makePc();
    if (S.convs.has(inc.conv)) openConv(inc.conv);
    this.refresh();
  },

  decline() {
    const inc = this.incoming;
    if (!inc) return;
    this.signal(inc.from, { type: 'decline', id: inc.id }, inc.dev);
    this.signal(S.me.id, { type: 'taken', id: inc.id });
    this.dismissIncoming();
  },

  async makePc() {
    const c = this.active;
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers(), iceTransportPolicy: S.opts.relay ? 'relay' : 'all' });
    c.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(c.peer, { type: 'ice', id: c.id, c: e.candidate.toJSON() }, c.peerDev); };
    pc.ontrack = (e) => {
      c.remote.addTrack(e.track);
      const audio = $('#remote-audio');
      audio.srcObject = c.remote;
      audio.play().catch(() => {});
      this.refresh();
    };
    pc.onconnectionstatechange = () => {
      if (this.active !== c) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        Sound.stop('CALL_RECONNECT_CONTINUOUS');
        if (!c.started) {
          c.started = Date.now();
          c.tick = setInterval(() => this.updateTimer(), 1000);
          c.statsTimer = setInterval(() => this.reportTurn(c), 60000);
          this.limitBitrate(c);
        }
        c.state = 'active';
        this.refresh();
      } else if (st === 'disconnected' && c.started) {
        c.state = 'reconnecting';
        Sound.play('CALL_RECONNECT_FRONT', { force: true });
        setTimeout(() => { if (this.active === c && c.state === 'reconnecting') Sound.play('CALL_RECONNECT_CONTINUOUS', { loop: true, force: true }); }, 2500);
        this.refresh();
      } else if (st === 'failed') {
        this.signal(c.peer, { type: 'hangup', id: c.id }, c.peerDev);
        this.end('failed');
      }
    };
    if (c.dir === 'out') {
      const [audio] = c.local.getAudioTracks();
      const [video] = c.local.getVideoTracks();
      pc.addTransceiver(audio, { direction: 'sendrecv', streams: [c.local] });
      if (video) pc.addTransceiver(video, { direction: 'sendrecv', streams: [c.local] });
      else pc.addTransceiver('video', { direction: 'sendrecv' });
    }
    return pc;
  },

  async onSignal(e) {
    const d = e.d || {};
    if (d.enc) {
      const conv = this.active?.conv || this.incoming?.conv;
      try {
        Object.assign(d, JSON.parse((await E2E.openEnvelope(conv, d.enc)).text));
      } catch {
        return;
      }
    }
    const c = this.active;
    switch (d.type) {
      case 'ring': {
        if (this.ended.has(d.id) || c?.id === d.id) return;
        if (c || this.incoming) {
          if (this.incoming?.id === d.id) return;
          this.signal(e.from, { type: 'busy', id: d.id }, e.dev);
          return;
        }
        this.incoming = { id: d.id, from: e.from, dev: e.dev, video: !!d.video, conv: Number(d.conv) };
        if (!S.convs.has(this.incoming.conv)) await loadConvs();
        this.showIncoming();
        return;
      }
      case 'cancel':
        if (this.incoming?.id === d.id) {
          const u = userOf(this.incoming.from);
          this.lastMissedNotice = this.incoming.conv;
          this.dismissIncoming();
          toast({ user: u, title: u.display_name, text: 'Gemiste oproep', onclick: () => openContact(u.id) });
        }
        return;
      case 'taken':
        if (this.incoming?.id === d.id) this.dismissIncoming();
        return;
      case 'accept':
        if (!c || c.id !== d.id || c.dir !== 'out') return;
        if (c.peerDev) {
          // Een ander apparaat van dezelfde persoon was te laat.
          this.signal(e.from, { type: 'hangup', id: d.id }, e.dev);
          return;
        }
        clearTimeout(c.timeout);
        c.peerDev = e.dev;
        c.state = 'connecting';
        Sound.stop('CALL_OUT');
        await this.makePc();
        await c.pc.setLocalDescription(await c.pc.createOffer());
        this.signal(c.peer, { type: 'offer', id: c.id, sdp: c.pc.localDescription.toJSON() }, c.peerDev);
        this.refresh();
        return;
      case 'offer': {
        if (!c || c.id !== d.id || e.dev !== c.peerDev) return;
        await c.pc.setRemoteDescription(d.sdp);
        const [aTx, vTx] = c.pc.getTransceivers();
        aTx.direction = 'sendrecv';
        await aTx.sender.replaceTrack(c.local.getAudioTracks()[0] || null);
        if (vTx) {
          vTx.direction = 'sendrecv';
          await vTx.sender.replaceTrack(c.local.getVideoTracks()[0] || null);
        }
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        this.signal(c.peer, { type: 'answer', id: c.id, sdp: c.pc.localDescription.toJSON() }, c.peerDev);
        this.flushIce();
        this.signal(c.peer, { type: 'media', id: c.id, video: !!c.local.getVideoTracks()[0] }, c.peerDev);
        return;
      }
      case 'answer':
        if (!c || c.id !== d.id || !c.pc) return;
        await c.pc.setRemoteDescription(d.sdp);
        this.flushIce();
        this.signal(c.peer, { type: 'media', id: c.id, video: !!c.local.getVideoTracks()[0] }, c.peerDev);
        return;
      case 'ice':
        if (!c || c.id !== d.id || !c.pc) return;
        if (!c.pc.remoteDescription) c.pendingIce.push(d.c);
        else c.pc.addIceCandidate(d.c).catch(() => {});
        return;
      case 'media':
        if (!c || c.id !== d.id) return;
        c.remoteVideo = !!d.video;
        this.refresh();
        return;
      case 'decline':
        if (!c || c.id !== d.id) return;
        Sound.stop('CALL_OUT');
        Sound.play('BUSY', { force: true });
        this.end('declined', true);
        return;
      case 'busy':
        if (!c || c.id !== d.id) return;
        Sound.stop('CALL_OUT');
        Sound.play('BUSY', { force: true });
        toast({ user: userOf(c.peer), title: nameOf(c.peer), text: 'is al in gesprek', plain: true });
        this.end('busy', true);
        return;
      case 'offline':
        if (!c || c.id !== d.id) return;
        Sound.stop('CALL_OUT');
        Sound.play('CALL_ERROR1', { force: true });
        toast({ user: userOf(c.peer), title: nameOf(c.peer), text: 'is niet online en kan nu niet gebeld worden', plain: true });
        this.end('offline', true);
        return;
      case 'hangup':
        if (c && c.id === d.id) this.end('hangup');
        else if (this.incoming?.id === d.id) this.dismissIncoming();
    }
  },

  // Via TURN (doorgestuurd)? Dan meten we hoeveel data dat kost en zetten de videokwaliteit lager.
  async relayInfo(c) {
    if (!c.pc) return { relay: false, bytes: 0 };
    const stats = await c.pc.getStats().catch(() => null);
    if (!stats) return { relay: false, bytes: 0 };
    let pair = null;
    stats.forEach((r) => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r; });
    if (!pair) return { relay: false, bytes: 0 };
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    return { relay, bytes: (pair.bytesSent || 0) + (pair.bytesReceived || 0) };
  },

  async reportTurn(c) {
    const info = await this.relayInfo(c);
    if (!info.relay) return;
    const fresh = info.bytes - (c.reported || 0);
    c.reported = info.bytes;
    if (fresh > 0) api('POST', 'usage/turn', { bytes: fresh }).catch(() => {});
  },

  // Kwaliteit aanpassen aan de verbinding: elke 2 seconden kijken hoeveel er past (en hoeveel er
  // verloren gaat) en daarop bitrate, resolutie en beeldsnelheid kiezen. Goede verbinding = beste kwaliteit.
  // Via TURN (doorgestuurd) gaat er nooit meer dan 1,5 Mbit/s door, zodat we binnen het gratis budget blijven.
  limitBitrate(c) {
    clearInterval(c.qualityTimer);
    c.qualityTimer = setInterval(() => this.adaptQuality(c), 2000);
    this.adaptQuality(c);
  },

  async adaptQuality(c) {
    if (!c.pc || this.active !== c) return clearInterval(c.qualityTimer);
    const stats = await c.pc.getStats().catch(() => null);
    if (!stats) return;
    let avail = 0;
    let rtt = 0;
    let lost = 0;
    let relay = false;
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
        avail = r.availableOutgoingBitrate || avail;
        rtt = r.currentRoundTripTime || rtt;
        const l = stats.get(r.localCandidateId);
        const rm = stats.get(r.remoteCandidateId);
        relay = l?.candidateType === 'relay' || rm?.candidateType === 'relay';
      }
      if (r.type === 'remote-inbound-rtp' && r.kind === 'video') lost = Math.max(lost, r.fractionLost || 0);
    });
    if (!avail) avail = 1_500_000;
    // Verlies of veel vertraging: een stap voorzichtiger.
    const effective = avail * (lost > 0.08 ? 0.5 : lost > 0.03 ? 0.75 : 1) * (rtt > 0.4 ? 0.7 : 1);
    const tiers = [
      { min: 3_500_000, bitrate: 4_000_000, scale: 1, fps: 30, bars: 4, label: 'Uitstekende verbinding' },
      { min: 1_500_000, bitrate: 2_000_000, scale: 1, fps: 30, bars: 3, label: 'Goede verbinding' },
      { min: 600_000, bitrate: 900_000, scale: 1.5, fps: 30, bars: 2, label: 'Redelijke verbinding' },
      { min: 250_000, bitrate: 400_000, scale: 2, fps: 20, bars: 1, label: 'Zwakke verbinding' },
      { min: 0, bitrate: 150_000, scale: 3, fps: 12, bars: 0, label: 'Slechte verbinding' }
    ];
    const tier = tiers.find((t) => effective >= t.min);
    const cap = relay ? 1_500_000 : Infinity;
    for (const sender of c.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      const screen = !!c.screen;
      p.encodings[0].maxBitrate = Math.min(cap, screen ? Math.max(tier.bitrate, 1_200_000) : tier.bitrate);
      p.encodings[0].scaleResolutionDownBy = screen ? 1 : tier.scale;
      p.encodings[0].maxFramerate = screen ? Math.min(tier.fps, 15) : tier.fps;
      p.degradationPreference = screen ? 'maintain-resolution' : 'balanced';
      sender.setParameters(p).catch(() => {});
    }
    c.quality = tier;
    const q = document.querySelector('#stage .quality');
    if (q) {
      q.title = `${tier.label}${relay ? ' (via de server)' : ''}`;
      q.dataset.bars = tier.bars;
    }
  },

  // Scherm delen (alleen op de computer).
  async toggleScreen() {
    const c = this.active;
    if (!c?.pc) return;
    const vTx = c.pc.getTransceivers()[1];
    if (c.screen) {
      c.screen.stop();
      c.local.removeTrack(c.screen);
      c.screen = null;
      let cam = null;
      if (c.camWasOn) {
        try {
          cam = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })).getVideoTracks()[0];
          c.local.addTrack(cam);
        } catch {}
      }
      await vTx?.sender.replaceTrack(cam);
    } else {
      let track;
      try {
        track = (await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })).getVideoTracks()[0];
      } catch {
        return;
      }
      track.contentHint = 'detail';
      const cam = c.local.getVideoTracks()[0];
      c.camWasOn = !!cam;
      if (cam) { cam.stop(); c.local.removeTrack(cam); }
      c.local.addTrack(track);
      c.screen = track;
      track.onended = () => { if (c.screen === track) this.toggleScreen(); };
      await vTx?.sender.replaceTrack(track);
    }
    c.video = !!c.local.getVideoTracks()[0];
    this.adaptQuality(c);
    this.signal(c.peer, { type: 'media', id: c.id, video: c.video, screen: !!c.screen }, c.peerDev);
    this.refresh();
  },

  flushIce() {
    const c = this.active;
    for (const cand of c.pendingIce.splice(0)) c.pc.addIceCandidate(cand).catch(() => {});
  },

  hangup() {
    if (this.incoming && !this.active) return this.decline();
    const c = this.active;
    if (!c) return;
    this.signal(c.peer, { type: c.state === 'ringing' ? 'cancel' : 'hangup', id: c.id }, c.peerDev || undefined);
    this.end(c.state === 'ringing' ? 'noanswer' : 'hangup');
  },

  // Gesprek afronden; de beller zet het in de chat ("Gesprek, 3:12" of "niet beantwoord").
  end(reason, silent = false) {
    const c = this.active;
    if (!c) return;
    this.active = null;
    clearTimeout(c.timeout);
    clearInterval(c.tick);
    clearInterval(c.reRing);
    clearInterval(c.statsTimer);
    clearInterval(c.qualityTimer);
    this.ended.add(c.id);
    this.reportTurn(c);
    Sound.stop('CALL_OUT');
    Sound.stop('CALL_RECONNECT_CONTINUOUS');
    if (!silent) Sound.play(reason === 'failed' ? 'CALL_ERROR1' : 'HANGUP', { force: true });
    c.pc?.close();
    c.local?.getTracks().forEach((t) => t.stop());
    $('#remote-audio').srcObject = null;
    if (c.dir === 'out') {
      const dur = c.started ? Math.round((Date.now() - c.started) / 1000) : 0;
      const body = { kind: 'call', duration: dur, video: c.video, missed: !dur && reason !== 'offline' && reason !== 'failed', failed: !dur && (reason === 'offline' || reason === 'failed') };
      api('POST', `conversations/${c.conv}/messages`, body).then(upsertAndRender).catch(() => {});
    }
    this.refresh();
  },

  toggleMute() {
    const c = this.active;
    if (!c) return;
    this.muted = !this.muted;
    c.local.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    Sound.play(this.muted ? 'HOLD' : 'RESUME', { force: true });
    this.refresh();
  },

  async toggleVideo() {
    const c = this.active;
    if (!c?.pc) return;
    const vTx = c.pc.getTransceivers()[1];
    const cur = c.local.getVideoTracks()[0];
    if (cur) {
      cur.stop();
      c.local.removeTrack(cur);
      await vTx?.sender.replaceTrack(null);
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        const track = s.getVideoTracks()[0];
        c.local.addTrack(track);
        await vTx?.sender.replaceTrack(track);
      } catch {
        return toastError('Skitta kan je camera niet gebruiken');
      }
    }
    c.video = !!c.local.getVideoTracks()[0];
    this.limitBitrate(c);
    this.signal(c.peer, { type: 'media', id: c.id, video: c.video }, c.peerDev);
    this.refresh();
  },

  showIncoming() {
    const inc = this.incoming;
    const u = userOf(inc.from);
    Sound.play('CALL_IN', { loop: true, force: S.me.presence_pref !== 'dnd' && S.opts.sounds });
    const box = h('div', { class: 'incoming', id: 'incoming' },
      h('div', { class: 'ih' }, h('img', { src: '/img/favicon.png', alt: '' }), inc.video ? 'Inkomend videogesprek' : 'Inkomend gesprek'),
      h('div', { class: 'ib' }, avatar(u, 'lg'), h('div', null, h('div', { class: 'nm' }, u.display_name), h('div', { class: 'what' }, inc.video ? 'wil met je videobellen' : 'belt je'))),
      h('div', { class: 'ibtns' },
        h('button', { class: 'sbtn green', onclick: () => this.accept(false) }, svg('phone'), 'Opnemen'),
        h('button', { class: 'sbtn blue', onclick: () => this.accept(true) }, svg('video'), 'Met video'),
        h('button', { class: 'sbtn red', onclick: () => this.decline() }, svg('hangup'), 'Weigeren')));
    document.body.append(box);
    if (document.visibilityState !== 'visible' || !document.hasFocus()) showLocal(`${u.display_name} belt je`, inc.video ? 'Videogesprek' : 'Gesprek', inc.conv, 'call');
    this.refresh();
  },

  dismissIncoming() {
    if (this.incoming) this.ended.add(this.incoming.id);
    Sound.stop('CALL_IN');
    $('#incoming')?.remove();
    this.incoming?.notification?.close();
    this.incoming = null;
    this.refresh();
  },

  updateTimer() {
    const c = this.active;
    if (!c?.started) return;
    const s = duration(Math.round((Date.now() - c.started) / 1000));
    for (const el of document.querySelectorAll('.call-timer')) el.textContent = s;
  },

  // Het belscherm boven het gesprek (of een balk als je een ander gesprek open hebt).
  view(conv) {
    const c = this.active;
    if (!c) return null;
    const u = userOf(c.peer);
    if (c.conv !== conv.id) {
      return h('div', { class: 'callbar' }, svg('phone'), h('span', { class: 'grow' }, `In gesprek met ${u.display_name} `, h('span', { class: 'call-timer' }, '')),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); openConv(c.conv); } }, 'Naar gesprek'),
        h('button', { class: 'sbtn red', style: { height: '24px' }, onclick: () => this.hangup() }, 'Ophangen'));
    }
    const remoteV = h('video', { class: 'remote', autoplay: true, playsinline: true, muted: true });
    remoteV.srcObject = c.remote;
    const hasRemoteVideo = c.remoteVideo && c.remote.getVideoTracks().length;
    remoteV.hidden = !hasRemoteVideo;
    const localTrack = c.local.getVideoTracks()[0];
    let localV = null;
    if (localTrack) {
      localV = h('video', { class: `local ${c.screen ? 'screen' : ''}`, autoplay: true, playsinline: true, muted: true });
      localV.srcObject = new MediaStream([localTrack]);
    }
    const stateText = { ringing: 'Bellen…', connecting: 'Verbinden…', reconnecting: 'Verbinding herstellen…', active: '' }[c.state] ?? '';
    const stage = h('div', { class: `stage ${hasRemoteVideo ? 'has-video' : ''}`, id: 'stage' },
      remoteV, localV,
      c.started ? h('div', { class: 'timer call-timer' }, duration(Math.round((Date.now() - c.started) / 1000))) : null,
      c.started ? h('div', { class: 'quality', 'data-bars': c.quality?.bars ?? 3, title: c.quality?.label || '' }, h('i'), h('i'), h('i'), h('i')) : null,
      h('div', { class: 'peer' }, avatar(u, 'xl'), h('div', { class: 'nm' }, u.display_name), h('div', { class: 'state' }, stateText || h('span', { class: 'call-timer' }, ''))),
      h('div', { class: 'bar' },
        h('button', { class: `cbtn ${this.muted ? 'off' : ''}`, title: this.muted ? 'Microfoon aanzetten' : 'Microfoon dempen', onclick: () => this.toggleMute() }, svg(this.muted ? 'micoff' : 'mic')),
        h('button', { class: `cbtn ${localTrack ? '' : 'off'}`, title: localTrack ? 'Video uitzetten' : 'Video aanzetten', disabled: !c.pc, onclick: () => this.toggleVideo() }, svg(localTrack ? 'video' : 'videooff')),
        navigator.mediaDevices?.getDisplayMedia && !mobile() ? h('button', { class: `cbtn ${c.screen ? 'on' : ''}`, title: c.screen ? 'Stoppen met scherm delen' : 'Scherm delen', disabled: !c.pc, onclick: () => this.toggleScreen() }, svg('screen')) : null,
        h('button', { class: 'cbtn', title: 'Volledig scherm', onclick: () => $('#stage')?.requestFullscreen?.() }, svg('full')),
        h('button', { class: 'sbtn red', onclick: () => this.hangup() }, svg('hangup'), 'Ophangen')));
    setTimeout(() => { remoteV.play().catch(() => {}); localV?.play().catch(() => {}); }, 0);
    return stage;
  },

  refresh() {
    try { window.SkittaNative?.callActive?.(!!this.active); } catch {}
    if (typeof S.cur === 'number') {
      const conv = S.convs.get(S.cur);
      const pane = $('#pane');
      const old = pane.querySelector('.stage, .callbar');
      const next = conv ? this.view(conv) : null;
      if (old && next) old.replaceWith(next);
      else if (old) old.remove();
      else if (next) $('#conv-head')?.after(next);
      renderHead();
    }
  }
};

function upsertAndRender(m) {
  if (bucket(m.c).loaded) upsertMessage(m);
  const conv = S.convs.get(m.c);
  if (conv) { conv.last = m; conv.last_at = m.at; }
  renderList();
  if (S.cur === m.c) renderMessages();
}

window.addEventListener('beforeunload', () => {
  if (Call.active) Call.hangup();
  else if (Call.incoming) Call.decline();
});

// ---------- Zijbalk ----------

function setupSide() {
  $('#tab-contacts').onclick = () => setTab('contacts');
  $('#tab-recent').onclick = () => setTab('recent');
  $('#home-link').onclick = showHome;
  $('#add-contact-btn').onclick = () => addContactDialog();
  $('#new-group-btn').onclick = () => groupDialog();
  $('#me-avatar').onclick = profileDialog;
  $('#me-status').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    popMenu([...presenceItems(), '-', { label: 'Profiel bewerken…', icon: 'user', run: profileDialog }], r.left, r.bottom + 2);
  };
  $('#search').addEventListener('input', (e) => { S.search = e.target.value; renderList(); });
  const mood = $('#me-mood');
  const saveMood = async () => {
    const v = mood.value.trim();
    if (v === (S.me.mood || '')) return;
    S.me.mood = v;
    try { await api('PATCH', 'me', { mood: v }); } catch (err) { toastError(err.message); }
  };
  mood.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mood.blur(); } if (e.key === 'Escape') { mood.value = S.me.mood || ''; mood.blur(); } });
  mood.addEventListener('blur', saveMood);

  // Zijbalk breder of smaller slepen.
  const split = $('#splitter');
  const w = store('sideWidth', 280);
  document.documentElement.style.setProperty('--side-w', `${w}px`);
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const nw = Math.max(220, Math.min(480, ev.clientX));
      document.documentElement.style.setProperty('--side-w', `${nw}px`);
      save('sideWidth', nw);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', () => split.removeEventListener('pointermove', move), { once: true });
  });
}

document.addEventListener('visibilitychange', () => {
  // Terug in de app: is de verbinding weggevallen, dan meteen opnieuw (niet wachten op de volgende poging).
  if (document.visibilityState === 'visible' && S.me && (!S.ws || S.ws.readyState > 1)) {
    clearTimeout(Live.retry);
    Live.delay = 1000;
    Live.connect();
  }
  if (document.visibilityState === 'visible' && typeof S.cur === 'number') {
    const last = S.convs.get(S.cur)?.last;
    if (last?.id && document.hasFocus()) markRead(S.cur, last.id);
    renderList();
  }
});

setupAuth();
setupSide();
setupNav();
start();
