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
      const a = new Audio(`/sounds/${file}.wav`);
      a.preload = 'auto';
      this.cache.set(file, a);
    }
    return this.cache.get(file);
  },
  play(name, { loop = false, force = false } = {}) {
    if (!S.opts.sounds && !force) return;
    if (!force && S.me?.presence_pref === 'dnd' && !['LOGIN', 'LOGOUT', 'CALL_OUT', 'CALL_INIT', 'HANGUP', 'BUSY'].includes(name)) return;
    const a = loop ? new Audio(`/sounds/${this.file(name)}.wav`) : this.el(name).cloneNode();
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
  tab: store('tab', 'contacts'),
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
      await api('POST', 'login', {
        login: $('#l-name').value, password: $('#l-pass').value,
        remember: $('#l-remember').checked, presence: $('#l-presence').value
      });
      $('#l-pass').value = '';
      await start(true);
    } catch (err) {
      $('#login-err').textContent = err.message;
    } finally {
      btn.disabled = false;
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
    const btn = $('#register-form .big-btn');
    btn.disabled = true;
    try {
      await api('POST', 'register', {
        display_name: $('#r-display').value, username: $('#r-name').value,
        password: $('#r-pass').value, email: $('#r-email').value
      });
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
  try { await api('POST', 'logout'); } catch {}
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
  await Promise.all([loadContacts(), loadConvs()]);
  S.ready = true;
  Live.connect();
  const hash = location.hash.match(/^#c(\d+)$/);
  if (hash && S.convs.has(Number(hash[1]))) openConv(Number(hash[1]));
  else showHome();
  renderList();
  if (fresh) Sound.play('LOGIN');
  if (isNew) setTimeout(() => profileDialog(), 400);
}

async function loadContacts() {
  const list = await api('GET', 'contacts');
  S.contacts = new Map(list.map((c) => [c.id, c]));
}

async function loadConvs() {
  const list = await api('GET', 'conversations');
  S.convs = new Map(list.map((c) => [c.id, c]));
  for (const c of list) for (const m of c.members) if (!S.contacts.has(m.id)) S.users.set(m.id, m);
  updateTitle();
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
  document.title = `${unread ? `(${unread}) ` : ''}Skitta™${S.me ? ` - ${S.me.username}` : ''}`;
  if (navigator.setAppBadge) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch?.(() => {});
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

  if (isNew && m.u !== S.me.id && m.k !== 'system') {
    stopTyping(m.c, m.u);
    const visible = S.cur === m.c && document.visibilityState === 'visible' && document.hasFocus();
    if (visible) markRead(m.c, m.id);
    else {
      conv.unread = (conv.unread || 0) + 1;
      if (!(m.k === 'call' && parseJson(m.b).missed && Call.lastMissedNotice === m.c)) notifyMessage(conv, m);
    }
    if (m.k !== 'call') Sound.play('IM');
  }
  updateTitle();
  renderList();
  if (S.cur === m.c) renderMessages({ keepScroll: !isNew || m.u !== S.me.id });
}

function notifyMessage(conv, m) {
  const u = userOf(m.u);
  const text = previewText(m);
  const title = conv.kind === 'group' ? `${u.display_name} in ${convTitle(conv)}` : u.display_name;
  toast({ user: u, title, text, onclick: () => openConv(conv.id) });
  if (S.opts.notifications && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body: text, icon: '/img/icon-192.png', tag: `c${conv.id}` });
      n.onclick = () => { window.focus(); openConv(conv.id); n.close(); };
    } catch {}
  }
}

function parseJson(s) {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}

function previewText(m) {
  if (!m) return '';
  if (m.rm) return 'Bericht verwijderd door de beheerder';
  if (m.del) return 'Bericht verwijderd';
  if (m.k === 'photo') return m.b ? `📷 ${m.b}` : '📷 Foto';
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
    default: return '';
  }
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

  if (S.tab === 'contacts' || q) {
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
    const convs = [...S.convs.values()].filter((c) => c.last || c.kind === 'group').sort((a, b) => b.last_at - a.last_at);
    for (const c of convs) list.append(convRow(c));
    if (!convs.length) list.append(h('div', { class: 'empty' }, 'Nog geen gesprekken.'));
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
  h('span', { class: `st ${statusClass(c)}` }),
  h('span', { class: 'name' }, c.display_name),
  h('span', { class: 'mood' }, c.state === 'in' ? 'wil je toevoegen' : c.state === 'out' ? 'wacht op goedkeuring' : c.mood),
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
    class: `row rich ${S.cur === conv.id ? 'on' : ''} ${unread ? 'unread' : ''}`, tabindex: 0,
    onclick: () => openConv(conv.id),
    oncontextmenu: (e) => { e.preventDefault(); convMenu(conv, e.clientX, e.clientY); }
  },
  h('span', { class: `st ${st}` }),
  h('div', { class: 'two' }, h('span', { class: 'name' }, convTitle(conv)), h('span', { class: 'mood' }, lastText)),
  unread ? h('span', { class: 'badge' }, unread) : h('span', { class: 'when' }, shortWhen(conv.last_at)));
}

// ---------- Rechterpaneel ----------

function showPaneOnMobile(on) {
  $('#app').classList.toggle('show-pane', on);
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
  if (window.innerWidth > 720) setTimeout(() => $('#compose-text')?.focus(), 0);
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
  pane.replaceChildren(...[
    h('header', { class: 'conv-head', id: 'conv-head' }),
    Call.view(conv),
    h('div', { class: 'chat', id: 'chat' }),
    h('div', { class: 'typing', id: 'typing' }),
    composeView(conv)
  ].filter(Boolean));
  if (carry != null && $('#compose-text')) $('#compose-text').value = carry;
  renderHead();
  renderMessages();
  renderTyping();
  setupDrop(pane, conv);
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
        h('button', { class: 'sbtn blue round', title: 'Personen toevoegen', disabled: !canTalk, onclick: () => groupDialog([c.id]) }, svg('plus')))
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
        h('button', { class: 'sbtn blue round', title: 'Personen toevoegen', disabled: conv.left, onclick: () => addPeopleDialog(conv) }, svg('plus')))
    );
  }
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
  if (b.loaded && b.more) chat.append(h('button', { class: 'btn more', onclick: () => loadOlder(conv.id) }, 'Eerdere berichten laden'));
  if (!b.loaded) chat.append(h('div', { class: 'day' }, 'Laden…'));
  let lastDay = null;
  let prev = null;
  for (const m of b.list) {
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
  if (b.loaded && !b.list.length) {
    chat.append(h('div', { class: 'day' }, conv.kind === 'direct' ? `Zeg hallo tegen ${convTitle(conv)}!` : 'Nog geen berichten'));
  }
  if (keepScroll && !nearBottom) chat.scrollTop = prevTop;
  else chat.scrollTop = chat.scrollHeight;
}

async function loadOlder(convId) {
  const b = bucket(convId);
  const first = b.list.find((m) => m.id);
  if (!first) return;
  try {
    const r = await api('GET', `conversations/${convId}/messages?before=${first.id}`);
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
  } else if (m.k === 'photo') {
    const img = h('img', {
      class: 'photo', alt: 'Foto', loading: 'lazy',
      src: m.localUrl || `/api/media/${encodeURIComponent(m.media)}`,
      onclick: () => lightbox(m.localUrl || `/api/media/${encodeURIComponent(m.media)}`)
    });
    if (m.w && m.h) {
      const scale = Math.min(1, 320 / m.w, 260 / m.h);
      img.style.width = `${Math.round(m.w * scale)}px`;
      img.style.aspectRatio = `${m.w} / ${m.h}`;
    }
    img.addEventListener('load', () => {
      const chat = $('#chat');
      if (chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 300) chat.scrollTop = chat.scrollHeight;
    }, { once: true });
    text = h('div', { class: 'text' }, img, m.b ? richText(m.b) : null);
  } else {
    text = h('div', { class: `text ${onlyEmoji(m.b) ? 'big-emo' : ''}` }, richText(m.b), m.ed ? h('span', { class: 'edited', title: `Bewerkt om ${time(m.ed)}` }, '(bewerkt)') : null);
  }
  const t = h('div', {
    class: 'time', title: new Date(m.at).toLocaleString('nl-NL'),
    onclick: m.failed ? () => retrySend(m) : null
  }, m.failed ? 'Opnieuw' : m.pending ? '…' : time(m.at));
  const row = h('div', { class: cls.join(' '), 'data-id': m.id || '' }, from, text, t);
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
    oninput: () => { autoGrow(ta); typingPing(conv.id); },
    onpaste: (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); sendPhoto(conv.id, file); }
    }
  });
  ta.value = S.drafts.get(conv.id) || '';
  S.drafts.delete(conv.id);
  setTimeout(() => autoGrow(ta), 0);
  const file = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: () => { for (const f of file.files) sendPhoto(conv.id, f); file.value = ''; }
  });
  const banner = S.editing
    ? h('div', { class: 'editing' }, svg('pencil'), 'Bericht bewerken', h('a', { href: '#', onclick: (e) => { e.preventDefault(); cancelEdit(); } }, 'Annuleren'))
    : S.replyTo
      ? h('div', { class: 'reply' }, svg('quote'), h('span', null, `Citaat van ${nameOf(S.replyTo.u)}: ${previewText(S.replyTo)}`), h('a', { href: '#', onclick: (e) => { e.preventDefault(); cancelEdit(); } }, 'Annuleren'))
      : null;
  return h('div', { class: 'compose' },
    h('div', { class: 'compose-tools' },
      h('button', { class: 'tool', title: 'Emoticons', onclick: (e) => emoticonMenu(e.currentTarget, ta) }, smileyIcon()),
      h('button', { class: 'tool', title: 'Foto versturen', onclick: () => file.click() }, svg('photo'), 'Foto versturen'),
      file),
    banner,
    h('div', { class: 'compose-box' }, ta,
      h('button', { class: 'sbtn blue', onclick: sendFromCompose, title: 'Verzenden (Enter)' }, S.editing ? 'Opslaan' : 'Verzenden')));
}

function smileyIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.innerHTML = '<defs><radialGradient id="sm" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff6a8"/><stop offset=".6" stop-color="#ffd21f"/><stop offset="1" stop-color="#eaa400"/></radialGradient></defs><circle cx="8" cy="8" r="7" fill="url(#sm)" stroke="#c48a00"/><circle cx="5.7" cy="6.3" r="1" fill="#5a3b00"/><circle cx="10.3" cy="6.3" r="1" fill="#5a3b00"/><path d="M4.7 9.3c.8 1.6 2 2.3 3.3 2.3s2.5-.7 3.3-2.3" fill="none" stroke="#5a3b00" stroke-width="1.1" stroke-linecap="round"/>';
  return s;
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(160, Math.max(44, ta.scrollHeight + 2))}px`;
}

function saveDraft() {
  const ta = $('#compose-text');
  if (ta && typeof S.cur === 'number' && !S.editing) S.drafts.set(S.cur, ta.value);
}

let typingSent = 0;
let typingStop = null;
function typingPing(convId) {
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
      const out = await api('PATCH', `messages/${m.id}`, { body: text });
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
    const m = await api('POST', `conversations/${convId}/messages`, { body: text, client_id: cid });
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
  while (blob && blob.size > 1_400_000 && q > 0.4) {
    q -= 0.15;
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
  }
  return { blob, w, h: hgt };
}

async function sendPhoto(convId, file, existing) {
  if (!file.type.startsWith('image/')) return toastError('Je kunt alleen foto\'s versturen');
  const cid = existing?.cid || uid();
  const local = existing || { id: 0, c: convId, u: S.me.id, k: 'photo', b: '', at: Date.now(), cid, pending: true, file, localUrl: URL.createObjectURL(file) };
  local.pending = true;
  local.failed = false;
  if (!existing) bucket(convId).list.push(local);
  if (S.cur === convId) renderMessages();
  try {
    const img = await prepareImage(file);
    local.w = img.w;
    local.h = img.h;
    const m = await api('POST', `conversations/${convId}/photo?w=${img.w}&h=${img.h}&cid=${cid}`, img.blob);
    upsertMessage({ ...m, localUrl: local.localUrl });
    const conv = S.convs.get(convId);
    if (conv) { conv.last = m; conv.last_at = m.at; }
    Sound.play('FT_COMPLETE');
  } catch (e) {
    local.pending = false;
    local.failed = true;
    Sound.play('FT_FAILED');
    toastError(e.message || 'De foto kon niet worden verstuurd');
  }
  if (S.cur === convId) renderMessages();
  renderList();
}

function setupDrop(pane, conv) {
  if (conv.left) return;
  let hint = null;
  let depth = 0;
  pane.ondragenter = (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    depth++;
    if (!hint) { hint = h('div', { class: 'drop-hint' }, 'Laat los om de foto te versturen'); pane.append(hint); }
  };
  pane.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); };
  pane.ondragleave = () => { if (--depth <= 0) { hint?.remove(); hint = null; depth = 0; } };
  pane.ondrop = (e) => {
    e.preventDefault();
    hint?.remove(); hint = null; depth = 0;
    for (const f of e.dataTransfer.files) sendPhoto(conv.id, f);
  };
}

// ---------- Menu's ----------

function closeLayer() {
  $('#layer').replaceChildren();
  for (const b of document.querySelectorAll('.menubar > button.open')) b.classList.remove('open');
}

function popMenu(items, x, y, opts = {}) {
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
  const gone = m.del || m.rm;
  const canEdit = mine && m.k === 'text' && !gone && Date.now() - m.at < 24 * 3600e3 && !conv.left;
  popMenu([
    !gone && m.k !== 'call' && { label: 'Kopiëren', icon: 'copy', run: () => navigator.clipboard?.writeText(m.k === 'photo' ? location.origin + `/api/media/${m.media}` : m.b.replace(/^> .+?: .*\n/, '')) },
    !gone && !conv.left && m.k !== 'call' && { label: 'Citeren', icon: 'quote', run: () => { S.replyTo = m; S.editing = null; saveDraft(); renderPane(); $('#compose-text')?.focus(); } },
    !gone && m.k === 'photo' && { label: 'Foto openen', icon: 'photo', run: () => lightbox(`/api/media/${encodeURIComponent(m.media)}`) },
    canEdit && '-',
    canEdit && { label: 'Bericht bewerken', icon: 'pencil', run: () => startEdit(m) },
    mine && !gone && m.k !== 'call' && { label: 'Bericht verwijderen', icon: 'trash', run: () => deleteMsg(m) },
    !mine && !gone && m.k !== 'call' && '-',
    !mine && !gone && m.k !== 'call' && { label: 'Bericht melden…', icon: 'flag', run: () => reportDialog(m) }
  ], x, y);
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
      { label: 'Recente gesprekken', checked: S.tab === 'recent', run: () => setTab('recent') }
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

function setTab(tab) {
  S.tab = tab;
  save('tab', tab);
  renderList();
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
        foot.querySelector('.left').append(h('button', { class: 'btn', onclick: () => b.run(close) }, b.label));
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
        h('button', { class: 'dclose', type: 'button', title: 'Sluiten', onclick: () => close(undefined) }, '✕')),
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
      try {
        await api('POST', 'me/password', { current: cur.value, password: pw.value });
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
    h('p', null, `Je meldt dit bericht van ${nameOf(m.u)} bij de beheerder van Skitta. De beheerder ziet alleen dit bericht, niet de rest van het gesprek.`),
    h('div', { class: 'bubble', style: { padding: '8px', background: '#f3f9fd', border: '1px solid #cfe2ee', borderRadius: '4px', marginBottom: '10px', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' } }, previewText(m)),
    h('fieldset', { class: 'opt-group' }, h('legend', null, 'Waarom meld je dit bericht?'), radios),
    note, err),
  [{
    label: 'Melden', default: true, run: async (close) => {
      try {
        const reason = radios.map((r) => r.querySelector('input')).find((i) => i.checked)?.value;
        await api('POST', `messages/${m.id}/report`, { reason, note: note.value });
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
  const notif = h('input', { type: 'checkbox', checked: o.notifications && 'Notification' in window && Notification.permission === 'granted' });
  notif.onchange = async () => {
    if (notif.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      notif.checked = r === 'granted';
    }
    o.notifications = notif.checked;
    saveOpts();
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
      h('label', null, notif, 'Systeemmeldingen als Skitta op de achtergrond staat'),
      cb('onlineToasts', 'Melding als een contactpersoon online komt')),
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

  async iceServers() {
    if (!this.ice || this.ice.at < Date.now() - 3600e3) {
      try { this.ice = { list: await api('GET', 'ice'), at: Date.now() }; } catch { return [{ urls: 'stun:stun.cloudflare.com:3478' }]; }
    }
    return this.ice.list;
  },

  signal(to, d, dev) {
    return Live.send({ t: 'call', to, dev, d });
  },

  async media(video) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
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
    this.signal(peer, { type: 'ring', id: this.active.id, video, conv: conv.id });
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
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() });
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
    const c = this.active;
    switch (d.type) {
      case 'ring': {
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
    if (S.opts.notifications && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(`${u.display_name} belt je`, { body: 'Skitta', icon: '/img/icon-192.png', tag: 'call', requireInteraction: true });
        n.onclick = () => { window.focus(); n.close(); };
        inc.notification = n;
      } catch {}
    }
    this.refresh();
  },

  dismissIncoming() {
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
      localV = h('video', { class: 'local', autoplay: true, playsinline: true, muted: true });
      localV.srcObject = new MediaStream([localTrack]);
    }
    const stateText = { ringing: 'Bellen…', connecting: 'Verbinden…', reconnecting: 'Verbinding herstellen…', active: '' }[c.state] ?? '';
    const stage = h('div', { class: `stage ${hasRemoteVideo ? 'has-video' : ''}`, id: 'stage' },
      remoteV, localV,
      c.started ? h('div', { class: 'timer call-timer' }, duration(Math.round((Date.now() - c.started) / 1000))) : null,
      h('div', { class: 'peer' }, avatar(u, 'xl'), h('div', { class: 'nm' }, u.display_name), h('div', { class: 'state' }, stateText || h('span', { class: 'call-timer' }, ''))),
      h('div', { class: 'bar' },
        h('button', { class: `cbtn ${this.muted ? 'off' : ''}`, title: this.muted ? 'Microfoon aanzetten' : 'Microfoon dempen', onclick: () => this.toggleMute() }, svg(this.muted ? 'micoff' : 'mic')),
        h('button', { class: `cbtn ${localTrack ? '' : 'off'}`, title: localTrack ? 'Video uitzetten' : 'Video aanzetten', disabled: !c.pc, onclick: () => this.toggleVideo() }, svg(localTrack ? 'video' : 'videooff')),
        h('button', { class: 'cbtn', title: 'Volledig scherm', onclick: () => $('#stage')?.requestFullscreen?.() }, svg('full')),
        h('button', { class: 'sbtn red', onclick: () => this.hangup() }, svg('hangup'), 'Ophangen')));
    setTimeout(() => { remoteV.play().catch(() => {}); localV?.play().catch(() => {}); }, 0);
    return stage;
  },

  refresh() {
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
  if (document.visibilityState === 'visible' && typeof S.cur === 'number') {
    const last = S.convs.get(S.cur)?.last;
    if (last?.id && document.hasFocus()) markRead(S.cur, last.id);
    renderList();
  }
});

setupAuth();
setupSide();
start();
