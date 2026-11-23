/* Skitta Lite — de webapp. Gewoon ES5 zonder bouwstap, zodat hij ook in Edge 14 op de Lumia 435 snel draait
   (geen arrow functions, geen const/let, geen NodeList.forEach, geen closest/append).
   Draait ook als webapp op de iPhone, in de Android-app (BellieNative) en als Lumia-app (window.Windows).
   Praat met de server van Skitta (src/lite.js daar): Lite-accounts, onversleutelde chats, ook met Skitta-gebruikers. */
(function () {
  'use strict';

  // ---------- kleine hulpjes ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function up(node, cls) {
    while (node && node !== document) {
      if (node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  var isLumia = !!(window.Windows && Windows.UI);
  function log(s) { if (window.__liteLog) window.__liteLog(s); } // naar de worker-log (fout.js)
  var Native = window.BellieNative || null;
  if (isLumia) document.documentElement.className += ' lumia';

  // ---------- iconen (dunne lijnen zoals Segoe MDL2) ----------
  var ICONS = {
    back: '<path d="M19 10H2.5M9.5 3l-7 7 7 7"/>',
    add: '<path d="M10 1.5v17M1.5 10h17"/>',
    more: '<circle cx="3.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
    send: '<path d="M1.5 2.5l17 7.5-17 7.5 2.8-7.5zM4.3 10H11"/>',
    photo: '<rect x="1.5" y="3.5" width="17" height="13"/><path d="M1.5 14l5-5 4.5 4.5 2.5-2.5 5 5"/><circle cx="14" cy="7.5" r="1.5"/>',
    video: '<rect x="1.5" y="5" width="11.5" height="10"/><path d="M13 9l5.5-3v8L13 11"/>',
    close: '<path d="M3 3l14 14M17 3L3 17"/>',
    play: '<path d="M1 1l16 9-16 9z" fill="currentColor" stroke="none"/>',
    phone: '<path d="M6 1.5l2.5 4-2 2c1 2.4 3.6 5 6 6l2-2 4 2.5-1 3.5C10 17.5 2.5 10 2.5 2.5z"/>',
    hangup: '<path d="M1.5 12c4.5-4.6 12.5-4.6 17 0l-1.5 3-4-1.2v-2.5c-2-.6-4-.6-6 0v2.5l-4 1.2z"/>',
    mic: '<rect x="7" y="1.5" width="6" height="10" rx="3"/><path d="M3.5 9.5a6.5 6.5 0 0013 0M10 16v2.5M6.5 18.5h7"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 20 20" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="miter">' + ICONS[name] + '</svg>';
  }
  function fillIcons(root) {
    each(root.querySelectorAll('i[data-ic]'), function (i) { i.innerHTML = icon(i.getAttribute('data-ic')); });
  }

  // ---------- thema en accentkleur ----------
  var ACCENTS = ['#FFB900', '#FF8C00', '#F7630C', '#CA5010', '#DA3B01', '#EF6950', '#D13438', '#FF4343',
    '#E74856', '#E81123', '#EA005E', '#C30052', '#E3008C', '#BF0077', '#C239B3', '#9A0089',
    '#0078D7', '#0063B1', '#8E8CD8', '#6B69D6', '#8764B8', '#744DA9', '#B146C2', '#881798',
    '#0099BC', '#2D7D9A', '#00B7C3', '#038387', '#00B294', '#018574', '#00CC6A', '#10893E',
    '#7A7574', '#5D5A58', '#68768A', '#515C6B', '#567C73', '#486860', '#498205', '#107C10',
    '#767676', '#4C4A48', '#69797E', '#4A5459', '#647C64', '#525E54', '#847545', '#7E735F'];
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var canAuto = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light), (prefers-color-scheme: dark)').matches);

  function hexRgb(h) { return { r: parseInt(h.substr(1, 2), 16), g: parseInt(h.substr(3, 2), 16), b: parseInt(h.substr(5, 2), 16) }; }
  function isDark() {
    var t = store('bc_theme') || (canAuto ? 'auto' : 'dark');
    if (t === 'auto') return canAuto ? darkQuery.matches : true;
    return t === 'dark';
  }
  function applyTheme() {
    var acc = store('bc_accent') || '#0078D7';
    var dark = isDark();
    document.body.className = dark ? '' : 'light';
    var css =
      '.avatar,.btn.primary,.row .count,.msg.out .bubble,#progress i,.appbar .amenu a.acc{background:ACC}' +
      '.msg.out .bubble:after{border-color:ACC transparent transparent transparent}' +
      '.tb:focus,body.light .tb:focus{border-color:ACC}.row.unread .prev,.hint a{color:ACC}' +
      '.btn.primary:active{background:ACC;opacity:.8}';
    var s = $('accentCss');
    if (!s) { s = el('style'); s.id = 'accentCss'; document.head.appendChild(s); }
    s.textContent = css.replace(/ACC/g, acc);
    var bg = dark ? '#000000' : '#ffffff';
    var bar = dark ? '#1f1f1f' : '#f2f2f2';
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', bg);
    if (Native && Native.theme) try { Native.theme(dark, bg, bar); } catch (e) {}
    lumiaStatusBar(dark);
  }
  if (darkQuery && darkQuery.addListener) darkQuery.addListener(applyTheme);

  function lumiaStatusBar(dark) {
    if (!isLumia) return;
    try {
      if (!Windows.Foundation.Metadata.ApiInformation.isTypePresent('Windows.UI.ViewManagement.StatusBar')) return;
      var sb = Windows.UI.ViewManagement.StatusBar.getForCurrentView();
      var c = dark ? 0 : 255;
      sb.backgroundColor = { a: 255, r: c, g: c, b: c };
      sb.backgroundOpacity = 1;
      sb.foregroundColor = dark ? { a: 255, r: 255, g: 255, b: 255 } : { a: 255, r: 0, g: 0, b: 0 };
    } catch (e) {}
  }

  // ---------- server ----------
  // Net als Belliechat: een token in plaats van een cookie (cookies werken niet goed in de Lumia-app).
  var token = store('bc_token');
  var me = null;
  if (token) try { me = JSON.parse(store('bc_me') || 'null'); } catch (e) {}

  var busy = 0;
  function progress(d) {
    busy = Math.max(0, busy + d);
    $('progress').className = busy ? 'on' : '';
  }

  // XHR in plaats van fetch: werkt overal en geeft uploadvoortgang.
  function request(method, path, data, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, path, true);
      var payload = null;
      if (opts.form) {
        payload = opts.form;
        if (opts.onprogress && x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable) opts.onprogress(e.loaded / e.total); };
      } else if (data !== undefined) {
        payload = JSON.stringify(data);
        x.setRequestHeader('Content-Type', 'application/json');
      }
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      if (opts.xhr) opts.xhr(x);
      x.onload = function () {
        var res = null;
        try { res = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) return resolve(res || {});
        if (x.status === 401 && me && path.indexOf('/api/lite/') !== 0) { signedOut(); }
        if (x.status === 401 && me && path === '/api/lite/chats') { signedOut(); }
        reject(new Error((res && res.error) || ('Fout ' + x.status)));
      };
      x.onerror = function () { reject(new Error('Geen verbinding. Probeer het zo opnieuw.')); };
      x.onabort = function () { reject(new Error('Afgebroken')); };
      x.send(payload);
    });
  }
  function api(method, path, data) {
    progress(1);
    return request(method, path, data).then(function (r) { progress(-1); return r; }, function (e) { progress(-1); throw e; });
  }

  // ---------- pagina's en terug ----------
  var stack = []; // open pagina's boven het hoofdscherm
  var base = null;

  function showBase(id) {
    each(document.querySelectorAll('.page'), function (p) { p.className = p.className.replace(/\s*\bon\b|\s*\benter\b/g, ''); });
    stack = [];
    base = id;
    $(id).className += ' on';
  }
  // reuse: de geschiedenisregel van de pagina die net dicht ging hergebruiken
  function openPage(id, onClose, reuse) {
    var p = $(id);
    p.className = p.className.replace(/\s*\benter\b/g, '') + ' on enter';
    stack.push({ id: id, onClose: onClose });
    if (!reuse) try { history.pushState({ bc: stack.length }, ''); } catch (e) {}
  }
  function closeTop() {
    var top = stack.pop();
    if (!top) return false;
    var p = $(top.id);
    p.className = p.className.replace(/\s*\bon\b|\s*\benter\b/g, '');
    if (top.onClose) top.onClose();
    return true;
  }
  // Terug: menu, dialoog of pagina dicht. Geeft true als er iets dicht ging.
  function back() {
    if (!$('dialog').hidden) { closeDialog(null); return true; }
    var openBar = document.querySelector('.appbar.open');
    if (openBar) { toggleBar(openBar, false); return true; }
    if (stack.length) { history.back(); return true; }
    if (base === 'p-main' && pivotIndex !== 0) { setPivot(0); return true; }
    return false;
  }
  window.addEventListener('popstate', function () {
    if (stack.length) closeTop();
  });
  window.bcBack = back; // voor de Android-app
  each(document.querySelectorAll('.back'), function (b) { b.addEventListener('click', function () { back(); }); });
  if (isLumia) {
    try {
      Windows.UI.Core.SystemNavigationManager.getForCurrentView().addEventListener('backrequested', function (e) {
        if (back()) e.handled = true;
      });
    } catch (e) {}
  }

  // ---------- app bar ----------
  var shade = el('div'); shade.id = 'shade'; $('app').appendChild(shade);
  function toggleBar(bar, open) {
    if (open === undefined) open = !bar.classList.contains('open');
    if (open) bar.classList.add('open'); else bar.classList.remove('open');
    shade.className = open ? 'on' : '';
  }
  shade.addEventListener('click', function () {
    var b = document.querySelector('.appbar.open');
    if (b) toggleBar(b, false);
  });
  each(document.querySelectorAll('.appbar'), function (bar) {
    bar.querySelector('.more').addEventListener('click', function () { toggleBar(bar); });
    each(bar.querySelectorAll('.amenu a'), function (a) {
      a.addEventListener('click', function () {
        toggleBar(bar, false);
        var act = a.getAttribute('data-act');
        if (act === 'settings') setPivot(1);
        if (act === 'refresh') { loadChats(); connect(); }
        if (act === 'toBottom') scrollBottom();
      });
    });
  });

  // ---------- dialoog en melding ----------
  var dialogCb = null;
  function dialog(title, text, buttons, cb) {
    $('dTitle').textContent = title;
    $('dText').textContent = text || '';
    var box = $('dBtns');
    box.innerHTML = '';
    each(buttons || ['ok'], function (label, i) {
      var b = el('button', 'btn' + (i === 0 ? ' primary' : ''), label);
      b.addEventListener('click', function () { closeDialog(i); });
      box.appendChild(b);
    });
    dialogCb = cb || null;
    $('dialog').hidden = false;
  }
  function closeDialog(i) {
    $('dialog').hidden = true;
    var cb = dialogCb;
    dialogCb = null;
    if (cb) cb(i);
  }
  function oops(e) { dialog('Dat lukte niet', e && e.message ? e.message : String(e)); }

  var toastTimer = null, toastChat = null;
  function toast(title, text, chatId) {
    var t = $('toast');
    t.innerHTML = '';
    t.appendChild(el('b', null, title));
    t.appendChild(document.createTextNode(text));
    toastChat = chatId;
    t.className = '';
    void t.offsetWidth;
    t.className = 'on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 4000);
  }
  $('toast').addEventListener('click', function () {
    $('toast').className = '';
    var c = findChat(toastChat);
    if (c) openChat(c);
  });

  // ---------- tijd ----------
  var DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  var MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(t) { var d = new Date(t); return d.getHours() + ':' + two(d.getMinutes()); }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayLabel(t) {
    var diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 86400000);
    if (diff === 0) return 'vandaag';
    if (diff === 1) return 'gisteren';
    var d = new Date(t);
    var s = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) s += ' ' + d.getFullYear();
    return s;
  }
  function shortTime(t) {
    var diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 86400000);
    if (diff === 0) return clock(t);
    if (diff < 7) return DAYS[new Date(t).getDay()];
    var d = new Date(t);
    return d.getDate() + '-' + (d.getMonth() + 1);
  }

  // ---------- inloggen ----------
  var signup = false;
  function setSignup(on) {
    signup = on;
    $('loginTitle').textContent = on ? 'nieuw account' : 'aanmelden';
    $('lGo').textContent = on ? 'account maken' : 'aanmelden';
    $('lSwitch').textContent = on ? 'Heb je al een account? Meld je aan.' : 'Nog geen account? Maak er een.';
    $('lPass2Row').hidden = !on;
    $('lPass').setAttribute('autocomplete', on ? 'new-password' : 'current-password');
    $('lErr').textContent = '';
  }
  $('lSwitch').addEventListener('click', function (e) { e.preventDefault(); setSignup(!signup); });
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('lName').value.trim(), pass = $('lPass').value;
    if (!name || !pass) { $('lErr').textContent = 'Vul je naam en wachtwoord in.'; return; }
    if (signup && pass !== $('lPass2').value) { $('lErr').textContent = 'De wachtwoorden zijn niet hetzelfde.'; return; }
    $('lGo').disabled = true;
    $('lErr').textContent = '';
    api('POST', signup ? '/api/lite/register' : '/api/lite/login', { name: name, pass: pass }).then(function (r) {
      $('lGo').disabled = false;
      $('lPass').value = $('lPass2').value = '';
      if (document.activeElement) document.activeElement.blur();
      signedIn(r.token, r.user);
    }, function (err) {
      $('lGo').disabled = false;
      $('lErr').textContent = err.message;
    });
  });

  function signedIn(t, user) {
    token = t; me = user;
    store('bc_token', t);
    store('bc_me', JSON.stringify(user));
    start();
  }
  function signedOut() {
    token = null; me = null;
    store('bc_token', null); store('bc_me', null);
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
    if (Call.active) endCall('', true);
    if (Call.incoming) dismissIncoming();
    nativeSession();
    lumiaSession();
    chats = []; current = null;
    $('chatList').innerHTML = '';
    showBase('p-login');
    setSignup(false);
  }
  $('logout').addEventListener('click', function () {
    dialog('Afmelden?', 'Je kunt je daarna weer aanmelden met je naam en wachtwoord.', ['afmelden', 'annuleren'], function (i) {
      if (i !== 0) return;
      dropPush().then(function () { return request('POST', '/api/logout'); }).then(signedOut, signedOut);
    });
  });

  // ---------- pivot ----------
  var pivotIndex = 0;
  function setPivot(i) {
    if (i === pivotIndex) return;
    var items = [$('chatList'), $('settings')];
    each(document.querySelectorAll('.pv'), function (p, j) { p.className = 'pv' + (j === i ? ' on' : ''); });
    items[pivotIndex].hidden = true;
    var it = items[i];
    it.className = it.className.replace(/\s*\bslide(back)?\b/g, '');
    it.hidden = false;
    void it.offsetWidth;
    it.className += i > pivotIndex ? ' slide' : ' slideback';
    pivotIndex = i;
    if (i === 1) showSettings();
  }
  each(document.querySelectorAll('.pv'), function (p) {
    p.addEventListener('click', function () { setPivot(+p.getAttribute('data-i')); });
  });
  // vegen tussen de pivots
  (function () {
    var body = $('pivotBody'), sx = 0, sy = 0, on = false;
    function startAt(x, y) { sx = x; sy = y; on = true; }
    function endAt(x, y) {
      if (!on) return;
      on = false;
      var dx = x - sx, dy = y - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) setPivot(dx < 0 ? 1 : 0);
    }
    if (window.PointerEvent) {
      body.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') startAt(e.clientX, e.clientY); });
      body.addEventListener('pointerup', function (e) { endAt(e.clientX, e.clientY); });
      body.addEventListener('pointercancel', function (e) { endAt(e.clientX, e.clientY); });
    } else {
      body.addEventListener('touchstart', function (e) { startAt(e.touches[0].clientX, e.touches[0].clientY); });
      body.addEventListener('touchend', function (e) { endAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
    }
  })();

  // ---------- instellingen ----------
  (function () {
    var box = $('accents');
    each(ACCENTS, function (c) {
      var a = el('a');
      a.style.background = c;
      a.setAttribute('data-c', c);
      a.addEventListener('click', function () { store('bc_accent', c); applyTheme(); markSettings(); });
      box.appendChild(a);
    });
    each(document.querySelectorAll('input[name=theme]'), function (r) {
      r.addEventListener('change', function () { store('bc_theme', r.value); applyTheme(); });
    });
    $('themeAutoRow').hidden = !canAuto;
  })();
  function markSettings() {
    var acc = store('bc_accent') || '#0078D7';
    each($('accents').childNodes, function (a) { a.className = a.getAttribute('data-c') === acc ? 'on' : ''; });
    var t = store('bc_theme') || (canAuto ? 'auto' : 'dark');
    each(document.querySelectorAll('input[name=theme]'), function (r) { r.checked = r.value === t; });
  }
  function showSettings() {
    markSettings();
    markPush();
    $('meName').textContent = me ? me.name : '';
    var ua = navigator.userAgent;
    var android = /Android/.test(ua) && !Native;
    var ios = /iPhone|iPad|iPod/.test(ua) && !window.navigator.standalone;
    $('getApp').hidden = !(android || ios);
    if (ios) {
      $('getAppText').textContent = 'Op de iPhone: tik in Safari op Delen en dan op "Zet op beginscherm". Dan werkt Skitta Lite als een app en krijg je ook meldingen.';
      $('getAppBtn').hidden = true;
    } else if (android) {
      $('getAppText').textContent = 'Er is ook een Android-app.';
      $('getAppBtn').hidden = false;
    }
  }

  // ---------- berichten van Skitta ----------
  // Skitta-formaat: { id, c, u, k, b, media, w, h, at, del, rm, e, cid }. Bijlagen zijn k 'photo' met in b
  // een JSON-beschrijving ({ t: 'photo' | 'video' | 'voice' | 'file' | 'gif' | 'sticker', thumb, name, ... }).
  function norm(s) {
    var m = { id: s.id, chat: s.c, from: s.u, kind: 'text', body: s.b || '', at: s.at, cid: s.cid || null, media: s.media || null, w: s.w, h: s.h };
    if (s.del || s.rm) { m.kind = 'note'; m.body = s.rm ? 'bericht verwijderd door de beheerder' : 'bericht verwijderd'; return m; }
    if (s.e) { m.kind = 'note'; m.body = 'versleuteld bericht (open Skitta om het te lezen)'; return m; }
    if (s.k === 'call') { m.kind = 'note'; m.body = callText(s); return m; }
    if (s.k === 'system') { m.kind = 'system'; return m; }
    if (s.k === 'photo') {
      var meta = null;
      if (m.body.indexOf('{"t":') === 0) { try { meta = JSON.parse(m.body); } catch (e) {} }
      meta = meta || { t: 'photo', cap: m.body };
      m.meta = meta;
      m.body = meta.cap || '';
      m.kind = meta.t === 'video' ? 'video' : meta.t === 'voice' ? 'voice' : meta.t === 'file' ? 'file' : 'photo';
      m.thumbSrc = meta.thumb || null;
      if (!m.media) { m.gone = 1; }
    }
    return m;
  }
  function callText(s) {
    var d = {};
    try { d = JSON.parse(s.b || '{}'); } catch (e) {}
    var kind = d.video ? 'videogesprek' : 'gesprek';
    if (d.failed) return kind + ' mislukt';
    if (d.missed) return me && s.u === me.id ? kind + ' niet beantwoord' : 'gemiste oproep';
    var t = d.dur || 0;
    return kind + ', ' + Math.floor(t / 60) + ':' + two(t % 60);
  }
  function mediaSrc(id) { return '/api/media/' + encodeURIComponent(id) + '?t=' + encodeURIComponent(token); }
  function previewOf(m) {
    if (!m) return '';
    if (m.kind === 'photo') return 'foto';
    if (m.kind === 'video') return 'video';
    if (m.kind === 'voice') return 'spraakbericht';
    if (m.kind === 'file') return 'bestand';
    return m.body;
  }

  // ---------- chatlijst ----------
  var chats = [];
  var current = null; // open chat
  function findChat(id) {
    for (var i = 0; i < chats.length; i++) if (chats[i].id === id) return chats[i];
    return null;
  }
  function preview(c) {
    if (!c.last) return c.user && !c.user.lite ? 'Skitta' : '';
    var who = c.last.from === (me && me.id) ? 'jij: ' : '';
    return who + previewOf(c.last);
  }
  function avatar(name, cls) {
    var a = el('span', 'avatar' + (cls ? ' ' + cls : ''), (name || '?').charAt(0));
    return a;
  }
  function renderChats() {
    var list = $('chatList');
    list.innerHTML = '';
    if (!chats.length) {
      list.appendChild(el('div', 'empty', 'Nog geen chats. Tik op + om iemand op Skitta of Skitta Lite een bericht te sturen.'));
    }
    var frag = document.createDocumentFragment();
    var total = 0;
    each(chats, function (c) {
      var row = el('div', 'row' + (c.unread ? ' unread' : ''));
      row.appendChild(avatar(c.user.name));
      var txt = el('div', 'txt');
      txt.appendChild(el('div', 'name', c.user.name));
      txt.appendChild(el('div', 'prev', preview(c)));
      row.appendChild(txt);
      var right = el('div', 'time', c.at ? shortTime(c.at) : '');
      if (c.unread) { right.appendChild(el('br')); right.appendChild(el('span', 'count', c.unread > 99 ? '99+' : String(c.unread))); }
      row.appendChild(right);
      row.addEventListener('click', function () { openChat(c); });
      frag.appendChild(row);
      total += c.unread || 0;
    });
    list.appendChild(frag);
    document.title = total ? '(' + total + ') Skitta Lite' : 'Skitta Lite';
    if (Native && Native.badge) try { Native.badge(total); } catch (e) {}
  }
  function loadChats() {
    return api('GET', '/api/lite/chats').then(function (r) {
      me = r.me;
      store('bc_me', JSON.stringify(me));
      each(r.chats, function (c) { c.last = c.last ? norm(c.last) : null; });
      // een net geopende lege chat blijft staan
      if (current && !current.last && !findIn(r.chats, current.id)) r.chats.unshift(current);
      chats = r.chats;
      if (current) { var c = findChat(current.id); if (c) { c.unread = 0; current = c; } }
      renderChats();
    }, function (e) { if (!chats.length) $('chatList').innerHTML = ''; throw e; });
  }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---------- nieuwe chat ----------
  var searchTimer = null, searchSeq = 0;
  $('newChat').addEventListener('click', function () {
    $('nQuery').value = '';
    $('nList').innerHTML = '';
    $('nList').appendChild(el('div', 'empty', 'Typ de naam van wie je wilt chatten.'));
    openPage('p-new');
    setTimeout(function () { $('nQuery').focus(); }, 250);
  });
  $('nQuery').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 250);
  });
  function search() {
    var q = $('nQuery').value.trim();
    var seq = ++searchSeq;
    var list = $('nList');
    if (q.length < 2) { list.innerHTML = ''; list.appendChild(el('div', 'empty', 'Typ minstens 2 letters.')); return; }
    api('GET', '/api/users/search?q=' + encodeURIComponent(q)).then(function (users) {
      if (seq !== searchSeq) return;
      list.innerHTML = '';
      if (!users.length) list.appendChild(el('div', 'empty', 'Niemand gevonden met die naam.'));
      each(users, function (u) {
        var row = el('div', 'row');
        row.appendChild(avatar(u.display_name));
        var txt = el('div', 'txt');
        txt.appendChild(el('div', 'name', u.display_name));
        txt.appendChild(el('div', 'prev', (u.lite ? 'Skitta Lite' : 'Skitta') + ' · ' + u.username));
        row.appendChild(txt);
        row.addEventListener('click', function () { startChat(u); });
        list.appendChild(row);
      });
    }, function () {});
  }
  function startChat(u) {
    if (document.activeElement) document.activeElement.blur();
    api('POST', '/api/lite/chats', { user: u.id }).then(function (r) {
      if (r.pending) {
        return dialog('Verzoek gestuurd', r.name + ' gebruikt Skitta en krijgt nu een verzoek. Zodra ' + r.name + ' dat accepteert, verschijnt de chat hier.', ['ok'], function () {
          if (stack.length) history.back();
        });
      }
      if (r.chat.last) r.chat.last = norm(r.chat.last);
      var c = findChat(r.chat.id) || r.chat;
      if (!findChat(c.id)) chats.unshift(c);
      closeTop(); // nieuwe chat dicht, het gesprek neemt zijn plek in
      openChat(c, true);
    }, oops);
  }

  // ---------- gesprek ----------
  var msgs = []; // berichten van de open chat, oud → nieuw
  var more = false, loadingOlder = false, lastReadSent = 0;
  var pendingSeq = 0;

  function openChat(c, reuse) {
    current = c;
    if (toastChat === c.id) $('toast').className = '';
    msgs = []; more = false; lastReadSent = 0;
    $('cName').textContent = c.user.name;
    var av = $('cAvatar');
    av.textContent = c.user.name.charAt(0);
    $('cMsgs').innerHTML = '';
    $('cOlder').hidden = true;
    if (!stack.length || stack[stack.length - 1].id !== 'p-chat') openPage('p-chat', closeChat, reuse);
    c.unread = 0;
    renderChats();
    api('GET', '/api/conversations/' + c.id + '/messages').then(function (r) {
      if (current !== c) return;
      var pending = [];
      each(msgs, function (m) { if (!m.id) pending.push(m); }); // net verstuurd terwijl de chat laadde
      msgs = normAll(r.messages).concat(pending);
      more = r.more;
      renderMsgs();
      scrollBottom();
      markRead();
    }, oops);
  }
  function normAll(list) {
    var out = [];
    each(list, function (s) { var m = norm(s); if (m.kind !== 'system') out.push(m); });
    return out;
  }
  function closeChat() {
    current = null;
    msgs = [];
    $('cMsgs').innerHTML = ''; // geheugen vrij (Lumia)
    $('cText').value = '';
    sizeText();
  }

  // Afmetingen van een foto/video in de bubbel: past binnen 240×260.
  function fit(w, h) {
    var mw = Math.min(240, Math.round(window.innerWidth * 0.66)), mh = 260;
    if (!w || !h) return { w: mw, h: Math.round(mw * 0.75) };
    var s = Math.min(mw / w, mh / h, 1.5);
    return { w: Math.max(80, Math.round(w * s)), h: Math.max(60, Math.round(h * s)) };
  }

  function msgNode(m) {
    var mine = me && m.from === me.id;
    var wrap = el('div', 'msg ' + (mine ? 'out' : 'in'));
    var b = el('div', 'bubble');
    wrap.appendChild(b);
    if (m.kind === 'text') {
      b.appendChild(document.createTextNode(m.body));
    } else if (m.kind === 'note') {
      b.appendChild(el('div', 'gone', m.body));
    } else if (m.kind === 'voice' || m.kind === 'file') {
      if (m.gone) b.appendChild(el('div', 'gone', 'niet meer beschikbaar'));
      else if (m.kind === 'voice') {
        var au = el('audio');
        au.controls = true;
        au.preload = 'none';
        au.src = mediaSrc(m.media);
        au.style.width = '210px';
        b.appendChild(au);
      } else {
        var a = el('a', 'file', (m.meta && m.meta.name) || 'bestand');
        a.href = mediaSrc(m.media);
        a.target = '_blank';
        b.appendChild(a);
      }
    } else {
      b.className += ' media';
      if (m.gone) {
        b.appendChild(el('div', 'gone', m.kind === 'video' ? 'video is opgeruimd' : 'foto is opgeruimd'));
      } else {
        var size = fit(m.w, m.h);
        var t = el('div', 'thumb');
        t.style.width = size.w + 'px';
        t.style.height = size.h + 'px';
        var src = m.local || m.thumbSrc || (m.kind === 'photo' && m.media ? mediaSrc(m.media) : null);
        if (src) {
          var img = el('img');
          img.alt = '';
          // grote foto's pas laden als ze in beeld komen (geheugen op de Lumia)
          if (src.indexOf('/api/') === 0) { img.setAttribute('data-src', src); lazyTimer(); } else img.src = src;
          t.appendChild(img);
        }
        if (m.kind === 'video') {
          var p = el('span', 'play');
          p.innerHTML = '<i>' + icon('play') + '</i>';
          t.appendChild(p);
        }
        if (!m.pending) t.addEventListener('click', function () { view(m); });
        b.appendChild(t);
        if (m.pending) {
          var bar = el('div', 'bar');
          var fill = el('i');
          bar.appendChild(fill);
          b.appendChild(bar);
          m.bar = fill;
        }
      }
    }
    if (m.body && (m.kind === 'photo' || m.kind === 'video')) b.appendChild(el('div', 'cap', m.body));
    if (m.failed) {
      var f = el('div', 'failed', 'Niet verstuurd. Tik om opnieuw te proberen.');
      f.addEventListener('click', function () { retry(m); });
      b.appendChild(f);
    }
    var meta = el('span', 'meta', m.pending && !m.failed ? 'versturen…' : clock(m.at));
    b.appendChild(meta);
    if (m.pending) wrap.className += ' pending';
    m.node = wrap;
    return wrap;
  }

  var lazyT = null;
  function lazyTimer() { clearTimeout(lazyT); lazyT = setTimeout(loadVisible, 60); }
  function loadVisible() {
    var s = $('cScroll');
    var sr = s.getBoundingClientRect();
    each(s.querySelectorAll('img[data-src]'), function (img) {
      var r = img.parentNode.getBoundingClientRect();
      if (r.bottom >= sr.top - 300 && r.top <= sr.bottom + 300) {
        img.src = img.getAttribute('data-src');
        img.removeAttribute('data-src');
      }
    });
  }

  function renderMsgs() {
    var box = $('cMsgs');
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    var lastDay = 0;
    each(msgs, function (m) {
      var d = dayStart(m.at);
      if (d !== lastDay) { frag.appendChild(el('div', 'day', dayLabel(m.at))); lastDay = d; }
      frag.appendChild(msgNode(m));
    });
    box.appendChild(frag);
    $('cOlder').hidden = !more;
  }
  function appendMsg(m) {
    var box = $('cMsgs');
    var prev = msgs.length > 1 ? msgs[msgs.length - 2] : null;
    if (!prev || dayStart(prev.at) !== dayStart(m.at)) box.appendChild(el('div', 'day', dayLabel(m.at)));
    box.appendChild(msgNode(m));
  }
  function replaceMsg(old, m) {
    var i = msgs.indexOf(old);
    if (i < 0) return;
    msgs[i] = m;
    var node = msgNode(m);
    if (old.node && old.node.parentNode) old.node.parentNode.replaceChild(node, old.node);
  }
  function hasMsg(id) {
    for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].id === id) return msgs[i];
    return null;
  }
  function nearBottom() {
    var s = $('cScroll');
    return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
  }
  function scrollBottom() {
    var s = $('cScroll');
    s.scrollTop = s.scrollHeight;
    // plaatjes kunnen later nog laden; de grootte staat vast, maar voor de zekerheid nog een keer
    setTimeout(function () { s.scrollTop = s.scrollHeight; }, 50);
  }

  function loadOlder() {
    if (!current || !more || loadingOlder || !msgs.length) return;
    loadingOlder = true;
    var c = current;
    var first = null;
    for (var i = 0; i < msgs.length; i++) if (msgs[i].id) { first = msgs[i].id; break; }
    api('GET', '/api/conversations/' + c.id + '/messages?before=' + first).then(function (r) {
      loadingOlder = false;
      if (current !== c) return;
      var s = $('cScroll');
      var fromBottom = s.scrollHeight - s.scrollTop;
      msgs = normAll(r.messages).concat(msgs);
      more = r.more;
      renderMsgs();
      s.scrollTop = s.scrollHeight - fromBottom;
    }, function () { loadingOlder = false; });
  }
  $('cScroll').addEventListener('scroll', function () {
    if ($('cScroll').scrollTop < 80) loadOlder();
    lazyTimer();
  });
  $('cOlder').addEventListener('click', loadOlder);

  var readTimer = null;
  function markRead() {
    if (!current || document.hidden) return;
    var last = 0;
    for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].id) { last = msgs[i].id; break; }
    if (!last || last <= lastReadSent) return;
    var c = current;
    clearTimeout(readTimer);
    readTimer = setTimeout(function () {
      lastReadSent = last;
      request('POST', '/api/conversations/' + c.id + '/read', { id: last }).then(null, function () {});
    }, 400);
  }

  // tekst sturen
  function sizeText() {
    var t = $('cText');
    t.style.height = '34px';
    var h = Math.min(110, Math.max(34, t.scrollHeight + 4));
    t.style.height = h + 'px';
    var extra = h - 34;
    $('p-chat').querySelector('.composer').style.height = (54 + extra) + 'px';
    $('cScroll').style.marginBottom = extra + 'px';
  }
  $('cText').addEventListener('input', sizeText);
  $('cText').addEventListener('keydown', function (e) {
    // Enter verstuurt op een computer; op de telefoon geeft Enter een nieuwe regel
    if (e.keyCode === 13 && !e.shiftKey && !('ontouchstart' in window) && !navigator.maxTouchPoints) { e.preventDefault(); sendText(); }
  });
  // mousedown voorkomen: anders gaat het toetsenbord dicht en springt de knop weg
  $('cSend').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('cSend').addEventListener('click', sendText);

  function localMsg(kind, extra) {
    var m = { id: 0, cid: 'c' + Date.now() + '_' + (++pendingSeq), chat: current.id, from: me.id, kind: kind, body: '', at: Date.now(), pending: true };
    for (var k in extra) m[k] = extra[k];
    return m;
  }
  function addLocal(m) {
    msgs.push(m);
    appendMsg(m);
    scrollBottom();
  }

  function sendText() {
    var text = $('cText').value.replace(/^\s+|\s+$/g, '');
    if (!text || !current) return;
    $('cText').value = '';
    sizeText();
    var m = localMsg('text', { body: text });
    addLocal(m);
    post(m);
  }
  function post(m) {
    var c = current;
    return request('POST', '/api/conversations/' + m.chat + '/messages', { body: m.body, client_id: m.cid }).then(function (res) {
      sent(c, m, norm(res));
    }, function (e) {
      m.failed = true;
      m.error = e.message;
      replaceMsg(m, m);
      if (!/verbinding/.test(e.message)) oops(e);
    });
  }
  // Het bericht staat op de server: het voorlopige bericht vervangen.
  function sent(c, m, real0) {
    var r = { message: real0 };
    (function () {
      var real = hasMsg(r.message.id);
      if (real && real !== m) { // de WebSocket was sneller
        var i = msgs.indexOf(m);
        if (i >= 0) { msgs.splice(i, 1); if (m.node && m.node.parentNode) m.node.parentNode.removeChild(m.node); }
      } else if (current === c) {
        replaceMsg(m, r.message);
      }
      bumpChat(c.id, r.message);
    })();
  }
  function retry(m) {
    m.failed = false;
    replaceMsg(m, m);
    if (m.kind === 'text') post(m);
    else uploadAndPost(m);
  }

  function bumpChat(chatId, m) {
    var c = findChat(chatId);
    if (!c) return;
    c.last = m;
    c.at = m.at;
    var i = chats.indexOf(c);
    if (i > 0) { chats.splice(i, 1); chats.unshift(c); }
    renderChats();
  }

  // ---------- foto's en video's kiezen ----------
  // Eerst kiezen: met de camera maken of uit de galerij. Wat je maakt wordt meteen verstuurd.
  $('cPhoto').addEventListener('click', function () { chooseSource('photo'); });
  $('cVideo').addEventListener('click', function () { chooseSource('video'); });
  // De chat waar de foto of video heen moet. Op de Lumia gaat de chat soms dicht terwijl de camera open is,
  // dus niet op `current` vertrouwen: na de camera gaat hij gewoon weer open.
  var mediaChat = null;
  function chooseSource(kind) {
    if (!current) return;
    mediaChat = current;
    var video = kind === 'video';
    dialog(video ? 'Video sturen' : 'Foto sturen', video ? 'Neem een video op of kies er een die je al hebt.' : 'Maak een foto of kies er een die je al hebt.',
      [video ? 'opnemen' : 'camera', 'kiezen', 'annuleren'], function (i) {
        if (i === 0) capture(kind);
        else if (i === 1) pick(kind);
      });
  }
  function capture(kind) {
    if (isLumia && lumiaCapture(kind)) return;
    var inp = $(kind === 'video' ? 'fVideoCam' : 'fPhotoCam');
    inp.value = '';
    inp.click();
  }
  function pick(kind) {
    if (isLumia && lumiaPick(kind)) return;
    var inp = $(kind === 'video' ? 'fVideo' : 'fPhoto');
    inp.value = '';
    inp.click();
  }
  function picked(kind, file) {
    var c = mediaChat || current;
    if (!file || !c) return;
    if (kind === 'video') sendVideo(file, c); else sendPhoto(file, c);
  }
  function backTo(c) {
    if (current === c) return;
    log('chat weer openen');
    openChat(c);
  }
  each(['fPhoto', 'fPhotoCam', 'fVideo', 'fVideoCam'], function (id) {
    $(id).addEventListener('change', function () { picked(/Video/.test(id) ? 'video' : 'photo', $(id).files[0]); });
  });

  // Lumia: camera en bestandskiezer van Windows zelf (de gewone <input> kan daar geen video's maken of kiezen).
  function storageToFile(sf, kind) {
    // Video's zelf inlezen tot een gewone Blob: een MSApp-bestand gaat in Edge 14 mis bij FormData/new Blob.
    if (kind !== 'video' && window.MSApp && MSApp.createFileFromStorageFile) return Promise.resolve(MSApp.createFileFromStorageFile(sf));
    return new Promise(function (resolve, reject) {
      Windows.Storage.FileIO.readBufferAsync(sf).then(function (buf) {
        var r = Windows.Storage.Streams.DataReader.fromBuffer(buf);
        var arr = new Uint8Array(buf.length);
        r.readBytes(arr);
        r.close();
        var b = new Blob([arr], { type: sf.contentType || (kind === 'video' ? videoType(sf.name) : '') });
        try { b.name = sf.name; } catch (e) {}
        resolve(b);
      }, reject);
    });
  }
  function videoType(name) {
    return /\.mov$/i.test(name || '') ? 'video/quicktime' : /\.3gp$/i.test(name || '') ? 'video/3gpp' : 'video/mp4';
  }
  function lumiaGot(kind, sf) {
    if (!sf) return log(kind + ': geannuleerd'); // geannuleerd
    log(kind + ': gekozen ' + sf.name + ' ' + sf.contentType);
    progress(1);
    storageToFile(sf, kind).then(function (f) {
      progress(-1);
      log(kind + ': ingelezen ' + f.size + ' ' + f.type);
      picked(kind, f);
    }, function (e) { progress(-1); log(kind + ': inlezen mislukt ' + (e && e.message)); oops(new Error('Het bestand kon niet gelezen worden.')); });
  }
  function lumiaCapture(kind) {
    try {
      var C = Windows.Media.Capture;
      var ui = new C.CameraCaptureUI();
      if (kind === 'video') {
        ui.videoSettings.format = C.CameraCaptureUIVideoFormat.mp4;
        ui.videoSettings.maxResolution = C.CameraCaptureUIMaxVideoResolution.standardDefinition; // 25 MB = ruim 2 minuten
        ui.videoSettings.maxDurationInSeconds = 150;
      } else {
        ui.photoSettings.format = C.CameraCaptureUIPhotoFormat.jpeg;
        ui.photoSettings.allowCropping = false;
      }
      ui.captureFileAsync(kind === 'video' ? C.CameraCaptureUIMode.video : C.CameraCaptureUIMode.photo).then(function (sf) {
        lumiaGot(kind, sf);
      }, function (e) { log(kind + ': camera mislukt ' + (e && e.message)); capture2(kind); });
      return true;
    } catch (e) { return false; }
  }
  function capture2(kind) { // CameraCaptureUI faalde: dan de gewone manier
    var inp = $(kind === 'video' ? 'fVideoCam' : 'fPhotoCam');
    inp.value = '';
    inp.click();
  }
  function lumiaPick(kind) {
    try {
      var P = Windows.Storage.Pickers;
      var p = new P.FileOpenPicker();
      p.viewMode = P.PickerViewMode.thumbnail;
      p.suggestedStartLocation = kind === 'video' ? P.PickerLocationId.videosLibrary : P.PickerLocationId.picturesLibrary;
      each(kind === 'video' ? ['.mp4', '.mov', '.3gp'] : ['.jpg', '.jpeg', '.png', '.gif'], function (t) { p.fileTypeFilter.append(t); });
      p.pickSingleFileAsync().then(function (sf) { lumiaGot(kind, sf); }, function () {});
      return true;
    } catch (e) { return false; }
  }

  // Browsers die foto's zelf rechtop zetten (iPhone, Android); Edge 14 doet dat niet, dan lezen we EXIF.
  var autoOrient = !!(window.CSS && CSS.supports && CSS.supports('image-orientation', 'from-image'));

  function exifOrientation(file) {
    return new Promise(function (resolve) {
      if (autoOrient || !/jpe?g/i.test(file.type)) return resolve(1);
      var r = new FileReader();
      r.onload = function () {
        try {
          var v = new DataView(r.result);
          if (v.getUint16(0) !== 0xFFD8) return resolve(1);
          var off = 2;
          while (off < v.byteLength - 4) {
            var marker = v.getUint16(off);
            var len = v.getUint16(off + 2);
            if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
              var t = off + 10;
              var le = v.getUint16(t) === 0x4949;
              var ifd = t + v.getUint32(t + 4, le);
              var n = v.getUint16(ifd, le);
              for (var i = 0; i < n; i++) {
                var e = ifd + 2 + i * 12;
                if (v.getUint16(e, le) === 0x0112) return resolve(v.getUint16(e + 8, le));
              }
              return resolve(1);
            }
            if ((marker & 0xFF00) !== 0xFF00) break;
            off += 2 + len;
          }
        } catch (e) {}
        resolve(1);
      };
      r.onerror = function () { resolve(1); };
      r.readAsArrayBuffer(file.slice(0, 131072));
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Deze foto kan niet geopend worden.')); };
      img.src = src;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) return canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
      // Edge 14: geen toBlob voor jpeg
      var data = atob(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      var arr = new Uint8Array(data.length);
      for (var i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i);
      resolve(new Blob([arr], { type: 'image/jpeg' }));
    });
  }

  // Tekent (een deel van) een bron verkleind op een canvas, eventueel gedraaid volgens EXIF.
  function drawScaled(src, sw, sh, max, orientation) {
    var rot = orientation >= 5 && orientation <= 8;
    var s = Math.min(1, max / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    var c = document.createElement('canvas');
    c.width = rot ? h : w;
    c.height = rot ? w : h;
    var x = c.getContext('2d');
    switch (orientation) {
      case 2: x.transform(-1, 0, 0, 1, w, 0); break;
      case 3: x.transform(-1, 0, 0, -1, w, h); break;
      case 4: x.transform(1, 0, 0, -1, 0, h); break;
      case 5: x.transform(0, 1, 1, 0, 0, 0); break;
      case 6: x.transform(0, 1, -1, 0, h, 0); break;
      case 7: x.transform(0, -1, -1, 0, h, w); break;
      case 8: x.transform(0, -1, 1, 0, 0, w); break;
    }
    x.drawImage(src, 0, 0, w, h);
    return c;
  }

  function prepPhoto(file) {
    var url = URL.createObjectURL(file);
    var orient = 1;
    return exifOrientation(file).then(function (o) {
      orient = o;
      return loadImage(url);
    }).then(function (img) {
      var big = drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height, 1600, orient);
      var small = drawScaled(big, big.width, big.height, 360, 1);
      var w = big.width, h = big.height;
      var keepGif = /gif/i.test(file.type) && file.size <= 4 * 1024 * 1024;
      return Promise.all([keepGif ? file : canvasBlob(big, 0.82), canvasBlob(small, 0.7)]).then(function (b) {
        big.width = big.height = 0; // geheugen terug (Lumia)
        URL.revokeObjectURL(url);
        return { full: b[0], fullType: keepGif ? 'image/gif' : 'image/jpeg', thumb: b[1], w: w, h: h };
      });
    }, function (e) { URL.revokeObjectURL(url); throw e; });
  }

  function prepVideo(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      var done = false;
      function finish(thumb) {
        if (done) return;
        done = true;
        var w = v.videoWidth, h = v.videoHeight;
        v.removeAttribute('src');
        try { v.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        resolve({ thumb: thumb, w: w, h: h });
      }
      v.muted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.onloadeddata = function () {
        try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) { finish(null); }
      };
      v.onseeked = function () {
        try {
          var c = drawScaled(v, v.videoWidth, v.videoHeight, 360, 1);
          canvasBlob(c, 0.7).then(finish, function () { finish(null); });
        } catch (e) { finish(null); }
      };
      v.onerror = function () { finish(null); };
      setTimeout(function () { finish(null); }, 6000);
      v.src = url;
      try { v.load(); } catch (e) {}
    });
  }

  function sendPhoto(file, c) {
    progress(1);
    prepPhoto(file).then(function (p) {
      progress(-1);
      backTo(c);
      var m = localMsg('photo', { w: p.w, h: p.h, local: URL.createObjectURL(p.thumb), blob: p.full, blobType: p.fullType, thumbBlob: p.thumb });
      addLocal(m);
      uploadAndPost(m);
    }, function (e) { progress(-1); oops(e); });
  }

  function sendVideo(file, c) {
    if (file.size > 25 * 1024 * 1024) {
      return dialog('Video te groot', 'Video\'s mogen maximaal 25 MB zijn. Deze is ' + Math.round(file.size / 1048576) + ' MB. Maak hem korter en probeer het opnieuw.');
    }
    progress(1);
    prepVideo(file).then(function (p) {
      progress(-1);
      log('video: voorbeeld ' + (p.thumb ? 'ja' : 'nee') + ' ' + p.w + 'x' + p.h + (current !== c ? ' (chat dicht)' : ''));
      backTo(c);
      var type = file.type || 'video/mp4';
      var m = localMsg('video', { w: p.w, h: p.h, local: p.thumb ? URL.createObjectURL(p.thumb) : null, blob: file, blobType: type, thumbBlob: p.thumb });
      addLocal(m);
      uploadAndPost(m);
    });
  }

  function dataUrl(blob) {
    return new Promise(function (resolve) {
      if (!blob) return resolve(null);
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { resolve(null); };
      r.readAsDataURL(blob);
    });
  }

  // Eén verzoek: het bestand met een klein voorbeeldplaatje in de beschrijving (zo ziet Skitta het ook).
  function uploadAndPost(m) {
    var c = current;
    function setBar(f) { if (m.bar) m.bar.style.width = Math.round(Math.min(1, f) * 100) + '%'; }
    dataUrl(m.thumbBlob).then(function (thumb) {
      var meta = { t: m.kind, name: m.blob.name || (m.kind === 'video' ? 'video.mp4' : 'foto.jpg'), size: m.blob.size, mime: m.blobType };
      if (thumb && thumb.length < 60000 && thumb.indexOf('data:image/jpeg;base64,') === 0) meta.thumb = thumb;
      var form = new FormData();
      form.append('file', m.blobType && m.blob.type !== m.blobType ? new Blob([m.blob], { type: m.blobType }) : m.blob, meta.name);
      form.append('meta', JSON.stringify(meta));
      form.append('w', String(m.w || 0));
      form.append('h', String(m.h || 0));
      form.append('cid', m.cid);
      if (m.kind === 'video') log('video: uploaden ' + m.blob.size);
      return request('POST', '/api/conversations/' + m.chat + '/plain', undefined, { form: form, onprogress: setBar });
    }).then(function (res) {
      if (m.kind === 'video') log('video: verstuurd');
      m.blob = null; m.thumbBlob = null;
      sent(c, m, norm(res));
    }, function (e) {
      log(m.kind + ': versturen mislukt ' + (e && e.message));
      m.failed = true;
      replaceMsg(m, m);
      oops(e);
    });
  }

  // ---------- groot bekijken ----------
  function view(m) {
    var box = $('vBody');
    box.innerHTML = '';
    if (m.kind === 'photo') {
      var img = el('img');
      img.alt = '';
      if (m.thumbSrc) img.src = m.thumbSrc; // meteen iets laten zien
      var full = new Image();
      full.onload = function () { img.src = full.src; };
      full.src = mediaSrc(m.media);
      box.appendChild(img);
    } else {
      var v = el('video');
      v.controls = true;
      v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.preload = 'auto';
      if (m.thumbSrc) v.poster = m.thumbSrc;
      v.src = mediaSrc(m.media);
      v.onerror = function () { dialog('Video speelt niet af', 'Deze telefoon kan dit soort video misschien niet afspelen.'); };
      box.appendChild(v);
    }
    openPage('p-view', function () {
      var v = box.querySelector('video');
      if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
      box.innerHTML = '';
    });
  }

  // ---------- live berichten ----------
  var ws = null, wsTimer = null, wsDelay = 1000, pingTimer = null, wsOk = false;
  function connect() {
    if (!me) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(wsTimer);
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try { ws = new WebSocket(proto + location.host + '/api/ws?dev=lite&t=' + encodeURIComponent(token)); } catch (e) { return retryConnect(); }
    var sock = ws;
    sock.onopen = function () {
      wsDelay = 1000;
      var wasOk = wsOk;
      wsOk = true;
      if (document.hidden) sock.send('{"t":"idle","on":true}');
      if (wasOk) catchUp(); // na een onderbreking alles bijwerken
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { if (sock.readyState === 1) sock.send('{"t":"ping"}'); }, 45000);
    };
    sock.onmessage = function (e) {
      var d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d.t === 'msg') onMessage(d);
      else if (d.t === 'read') onRead(d);
      else if (d.t === 'contacts' && d.accepted) onAccepted(d.accepted);
      else if (d.t === 'conv') loadChats().then(null, function () {});
      else if (d.t === 'call') onCallSignal(d);
      else if (d.t === 'kick') signedOut();
    };
    sock.onclose = function () {
      clearInterval(pingTimer);
      if (ws === sock) { ws = null; retryConnect(); }
    };
    sock.onerror = function () {};
  }
  function retryConnect() {
    clearTimeout(wsTimer);
    if (document.hidden || !me) return;
    wsTimer = setTimeout(connect, wsDelay);
    wsDelay = Math.min(30000, wsDelay * 2);
  }
  function catchUp() {
    loadChats().then(null, function () {});
    if (current && msgs.length) {
      var c = current, last = 0;
      for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].id) { last = msgs[i].id; break; }
      request('GET', '/api/conversations/' + c.id + '/messages?after=' + last).then(function (r) {
        if (current !== c) return;
        var stick = nearBottom();
        each(normAll(r.messages), function (m) { if (!hasMsg(m.id)) { msgs.push(m); appendMsg(m); } });
        if (stick) scrollBottom();
        markRead();
      }, function () {});
    }
  }

  function onMessage(d) {
    var m = norm(d.m);
    if (m.kind === 'system') { loadChats().then(null, function () {}); return; }
    var mine = me && m.from === me.id;
    var known = current && current.id === m.chat ? hasMsg(m.id) : null;
    if (current && current.id === m.chat) {
      if (known) {
        replaceMsg(known, m); // bewerkt of verwijderd
      } else {
        var local = null;
        if (mine && m.cid) for (var i = 0; i < msgs.length; i++) if (msgs[i].cid === m.cid && !msgs[i].id) { local = msgs[i]; break; }
        if (local) replaceMsg(local, m);
        else {
          var stick = nearBottom();
          msgs.push(m);
          appendMsg(m);
          if (stick || mine) scrollBottom();
        }
      }
      if (!document.hidden) markRead();
    }
    var c = findChat(m.chat);
    if (!c) { loadChats().then(null, function () {}); }
    else if (!known) {
      c.last = m;
      c.at = m.at;
      var viewing = current && current.id === m.chat && !document.hidden;
      if (!mine && !viewing && !d.m.ed && !d.m.del) c.unread = (c.unread || 0) + 1;
      var idx = chats.indexOf(c);
      if (idx > 0) { chats.splice(idx, 1); chats.unshift(c); }
      renderChats();
    }
    if (!mine && !known && !d.m.ed && !d.m.del && !(current && current.id === m.chat)) {
      toast(c ? c.user.name : 'Nieuw bericht', m.kind === 'text' || m.kind === 'note' ? m.body : 'stuurde een ' + previewOf(m), m.chat);
    }
    if (!mine && !known && !d.m.ed && !d.m.del) notifyAway(c ? c.user.name : 'Skitta Lite', m.kind === 'text' || m.kind === 'note' ? m.body : 'stuurde een ' + previewOf(m), 'c' + m.chat);
  }
  function onRead(d) {
    if (!me || d.u !== me.id) return;
    var c = findChat(d.c);
    if (c && c.unread) { c.unread = 0; renderChats(); }
  }
  // Een Skitta-gebruiker heeft je verzoek geaccepteerd: de chat meteen klaarzetten.
  function onAccepted(uid) {
    request('POST', '/api/lite/chats', { user: uid }).then(function (r) {
      if (!r.chat) return;
      loadChats().then(function () { toast(r.chat.user.name, 'heeft je verzoek geaccepteerd. Jullie kunnen nu chatten.', r.chat.id); }, function () {});
    }, function () {});
  }

  document.addEventListener('visibilitychange', function () {
    // Niet in beeld = "afwezig": dan stuurt de server pushmeldingen (de pagina zelf geeft er dan geen).
    if (ws && ws.readyState === 1) try { ws.send(document.hidden ? '{"t":"idle","on":true}' : '{"t":"idle","on":false}'); } catch (e) {}
    if (document.hidden) return;
    if (!me) return;
    if (isLumia) lumiaUntoast('call');
    if (!ws) { wsDelay = 1000; connect(); }
    catchUp(); // de verbinding kan op de achtergrond stil zijn doodgegaan
    markRead();
  });
  window.addEventListener('online', function () { if (me && !ws) { wsDelay = 1000; connect(); } });

  // ---------- meldingen ----------
  // Web: pushmeldingen via de service worker (iPhone-beginschermapp, Chrome). Android-app: de app houdt zelf een
  // verbinding open (BellieNative.session). Lumia: Windows-meldingen zolang de app nog draait, en een
  // achtergrondtaak (bg.js in het appx-pakket) die elk kwartier kijkt of er iets nieuws is.
  var swReg = null;
  var canPush = !Native && !isLumia && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (canPush) {
    navigator.serviceWorker.register('sw.js').then(function (r) { swReg = r; if (me) syncPush(); }, function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.t === 'open') liteOpen(e.data.c);
    });
  }
  function pushOn() { return canPush && Notification.permission === 'granted'; }
  function b64uBytes(s) {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var raw = atob(t), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  // Abonnement (opnieuw) aan de server geven; het kan na een update van de browser veranderd zijn.
  function syncPush(ask) {
    if (!swReg || !me) return Promise.resolve(false);
    if (!ask && !pushOn()) return Promise.resolve(false);
    var perm = Notification.permission === 'granted' ? Promise.resolve('granted') : new Promise(function (resolve) {
      var p = Notification.requestPermission(resolve);
      if (p && p.then) p.then(resolve);
    });
    return perm.then(function (r) {
      if (r !== 'granted') throw new Error('Meldingen zijn niet toegestaan. Zet ze aan in de instellingen van je telefoon.');
      return swReg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub) return sub;
      return request('GET', '/api/push/key').then(function (k) {
        return swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(k.key) });
      });
    }).then(function (sub) {
      return request('POST', '/api/push', JSON.parse(JSON.stringify(sub)));
    }).then(function () { return true; });
  }
  function dropPush() {
    if (!swReg) return Promise.resolve();
    return swReg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return;
      return request('DELETE', '/api/push', { endpoint: sub.endpoint }).then(null, function () {}).then(function () { return sub.unsubscribe(); });
    }).then(null, function () {});
  }
  function markPush() {
    var box = $('pushBox');
    box.hidden = !canPush;
    if (!canPush) return;
    var on = pushOn();
    $('pushBtn').hidden = on;
    $('pushText').textContent = on ? 'Meldingen staan aan. Je krijgt een melding bij nieuwe berichten en als iemand je belt.'
      : Notification.permission === 'denied' ? 'Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je telefoon of browser.'
      : 'Krijg een melding bij nieuwe berichten en als iemand je belt, ook als Skitta Lite dicht is.';
  }
  $('pushBtn').addEventListener('click', function () {
    syncPush(true).then(markPush, function (e) { markPush(); oops(e); });
  });

  // Android-app: de achtergrondverbinding van de app weet zo wie je bent.
  function nativeSession() {
    if (Native && Native.session) try { Native.session(token || '', me ? me.id : 0); } catch (e) {}
  }

  // Lumia: token voor de achtergrondtaak en die taak aanmelden (alleen in een pakket dat bg.js heeft).
  function lumiaSession() {
    if (!isLumia) return;
    try {
      var vals = Windows.Storage.ApplicationData.current.localSettings.values;
      if (token) vals.insert('token', token); else vals.remove('token');
    } catch (e) {}
    if (!token) return;
    try {
      var B = Windows.ApplicationModel.Background;
      B.BackgroundExecutionManager.requestAccessAsync().then(function () {
        try {
          var it = B.BackgroundTaskRegistration.allTasks.first();
          while (it.hasCurrent) {
            if (it.current.value.name === 'skittalite') return;
            it.moveNext();
          }
          var b = new B.BackgroundTaskBuilder();
          b.name = 'skittalite';
          b.taskEntryPoint = 'bg.js';
          b.setTrigger(new B.TimeTrigger(15, false));
          b.addCondition(new B.SystemCondition(B.SystemConditionType.internetAvailable));
          b.register();
          log('achtergrondtaak aangemeld');
        } catch (e) { log('achtergrondtaak: ' + e.message); }
      }, function () {});
    } catch (e) {}
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lumiaToast(title, text, tag, ring) {
    try {
      var N = Windows.UI.Notifications;
      var doc = new Windows.Data.Xml.Dom.XmlDocument();
      doc.loadXml('<toast launch="' + xmlEsc(tag) + '"' + (ring ? ' scenario="incomingCall" duration="long"' : '') + '><visual><binding template="ToastGeneric"><text>' +
        xmlEsc(title) + '</text><text>' + xmlEsc(text) + '</text></binding></visual>' +
        (ring ? '<audio src="ms-winsoundevent:Notification.Looping.Call" loop="true"/>' : '') + '</toast>');
      var t = new N.ToastNotification(doc);
      try { t.tag = tag; } catch (e) {}
      N.ToastNotificationManager.createToastNotifier().show(t);
    } catch (e) {}
  }
  function lumiaUntoast(tag) {
    try { Windows.UI.Notifications.ToastNotificationManager.history.remove(tag); } catch (e) {}
  }
  // Melding terwijl de app op de achtergrond nog draait. Web met push: de server stuurt die al.
  function notifyAway(title, text, tag, ring) {
    if (!document.hidden) return;
    if (isLumia) lumiaToast(title, text, tag, ring);
  }

  // Openen vanuit een melding: naar de chat, en bij "opnemen" de oproep meteen aannemen.
  function liteOpen(c, answer) {
    c = +c || 0;
    if (answer) Call.autoAnswer = { conv: c, until: Date.now() + 30000 };
    if (Call.incoming && answer && (!c || Call.incoming.conv === c)) return acceptCall(Call.incoming.video);
    if (!c || Call.active || Call.incoming) return;
    var chat = findChat(c);
    if (chat) { if (!current || current.id !== c) openChat(chat); }
    else loadChats().then(function () { var x = findChat(c); if (x) openChat(x); }, function () {});
  }
  window.liteOpen = liteOpen;
  // Lumia: getikt op een melding (launch="c<id>" uit bg.js of een belmelding).
  if (isLumia) {
    try {
      Windows.UI.WebUI.WebUIApplication.addEventListener('activated', function (e) {
        var m = /^c(\d+)$/.exec((e && e.arguments) || '');
        if (m && me) liteOpen(+m[1]);
      });
    } catch (e) {}
  }

  // ---------- bellen ----------
  // Hetzelfde protocol als Skitta (public/app.js, Call): ring → accept → offer/answer/ice via de Hub,
  // alleen niet versleuteld (Skitta Lite heeft geen sleutels). Lumia: Edge 14 heeft alleen ORTC, adapter.js
  // maakt daar een RTCPeerConnection van (alleen geluid).
  var Call = { active: null, incoming: null, ended: {}, ice: null, muted: false, camOff: false, autoAnswer: null };
  function rtcPossible() {
    return !!((window.RTCPeerConnection || window.webkitRTCPeerConnection || window.RTCIceGatherer) &&
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  var adapterLoad = null;
  function ensureRtc() {
    if (window.RTCPeerConnection) return Promise.resolve(true);
    if (window.webkitRTCPeerConnection) { window.RTCPeerConnection = window.webkitRTCPeerConnection; return Promise.resolve(true); }
    if (!window.RTCIceGatherer) return Promise.resolve(false);
    if (!adapterLoad) {
      adapterLoad = new Promise(function (resolve) {
        var sc = document.createElement('script');
        sc.src = 'adapter.js?v=1';
        sc.onload = function () { resolve(!!window.RTCPeerConnection); };
        sc.onerror = function () { adapterLoad = null; resolve(false); };
        document.head.appendChild(sc);
      });
    }
    return adapterLoad;
  }
  var NO_CALL = 'Bellen werkt niet op dit toestel.';
  function callId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function signal(to, d, dev) {
    var o = { t: 'call', to: to, d: d };
    if (dev) o.dev = dev;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(o)); } catch (e) { return false; }
    return true;
  }
  function iceServers() {
    if (Call.ice && Call.ice.at > Date.now() - 3600000) return Promise.resolve(Call.ice.list);
    return request('GET', '/api/ice').then(function (list) {
      Call.ice = { list: list, at: Date.now() };
      return list;
    }, function () { return [{ urls: 'stun:stun.cloudflare.com:3478' }]; });
  }
  function getMedia(video) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video && !isLumia ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
    });
  }
  function stopTracks(stream) {
    if (stream) each(stream.getTracks(), function (t) { try { t.stop(); } catch (e) {} });
  }
  function nameFor(uid) {
    for (var i = 0; i < chats.length; i++) if (chats[i].user && chats[i].user.id === uid) return chats[i].user.name;
    return 'Iemand';
  }
  function chatWith(uid) {
    for (var i = 0; i < chats.length; i++) if (chats[i].user && chats[i].user.id === uid) return chats[i];
    return null;
  }

  // geluiden (in de Android-app rinkelt de melding van de app zelf als hij op de achtergrond staat)
  var sounds = {};
  function sound(name, loop) {
    if (name === 'CALL_IN' && Native && Native.front && !Native.front()) return;
    try {
      var a = sounds[name] || (sounds[name] = new Audio('sounds/' + name + '.m4a'));
      a.loop = !!loop;
      a.currentTime = 0;
      var p = a.play();
      if (p && p.then) p.then(null, function () {});
    } catch (e) {}
  }
  function silence() {
    for (var k in sounds) if (sounds.hasOwnProperty(k) && sounds[k].loop) try { sounds[k].pause(); } catch (e) {}
  }

  function nativeCall(on) {
    if (Native && Native.callActive) try { Native.callActive(on); } catch (e) {}
  }

  // ---- scherm ----
  function showCall() {
    var a = Call.active, inc = Call.incoming;
    var box = $('call');
    if (!a && !inc) { box.hidden = true; return; }
    var name = a ? a.name : inc.name;
    box.hidden = false;
    $('kName').textContent = name;
    $('kAvatar').textContent = name.charAt(0);
    $('kIn').hidden = !inc || !!a;
    $('kOn').hidden = !a;
    $('kAcceptV').hidden = !(inc && inc.video) || isLumia;
    var vid = !!(a && (a.remoteVideo || a.local && a.local.getVideoTracks().length));
    box.className = vid ? 'vid' : '';
    $('kRemote').hidden = !(a && a.remoteVideo);
    $('kLocal').hidden = !(a && a.local && a.local.getVideoTracks().length) || Call.camOff;
    $('kCam').hidden = !(a && a.local && a.local.getVideoTracks().length);
    $('kMute').className = 'kb' + (Call.muted ? ' on' : '');
    $('kCam').className = 'kb' + (Call.camOff ? ' on' : '');
    $('kState').textContent = callState();
  }
  function callState() {
    var a = Call.active, inc = Call.incoming;
    if (!a) return inc ? (inc.video ? 'wil met je videobellen' : 'belt je') : '';
    if (a.state === 'ringing') return 'bellen…';
    if (a.state === 'connecting') return 'verbinden…';
    if (a.state === 'reconnecting') return 'verbinding herstellen…';
    if (a.state === 'ended') return a.endText || 'gesprek beëindigd';
    var s = Math.max(0, Math.round((Date.now() - a.started) / 1000));
    return Math.floor(s / 60) + ':' + two(s % 60);
  }

  // ---- zelf bellen ----
  function startCall(c, video) {
    if (Call.active || Call.incoming) return;
    if (!c || !c.user) return;
    if (!ws || ws.readyState !== 1) { connect(); return dialog('Bellen', 'Nog geen verbinding. Probeer het zo opnieuw.'); }
    ensureRtc().then(function (ok) {
      if (!ok) throw new Error(NO_CALL);
      return getMedia(video);
    }).then(function (stream) {
      if (Call.active || Call.incoming) { stopTracks(stream); return; }
      var a = Call.active = {
        id: callId(), peer: c.user.id, name: c.user.name, conv: c.id, dir: 'out', video: !!video, local: stream,
        state: 'ringing', peerDev: null, pendingIce: [], started: 0, remoteVideo: false
      };
      Call.muted = false; Call.camOff = false;
      $('kLocal').srcObject = stream;
      nativeCall(true);
      showCall();
      sound('CALL_OUT', true);
      var ring = { type: 'ring', id: a.id, video: !!video, conv: c.id };
      signal(a.peer, ring);
      // herhalen: wie de app opent na een melding, krijgt de oproep alsnog binnen
      a.reRing = setInterval(function () {
        if (Call.active === a && a.state === 'ringing') signal(a.peer, ring); else clearInterval(a.reRing);
      }, 4000);
      a.timeout = setTimeout(function () {
        if (Call.active === a && a.state === 'ringing') {
          signal(a.peer, { type: 'cancel', id: a.id });
          endCall('geen antwoord');
        }
      }, 45000);
    }, function (e) {
      log('bellen: ' + (e && (e.name || e.message)));
      dialog('Bellen', e && e.message === NO_CALL ? NO_CALL : 'Skitta Lite kan je microfoon' + (video ? ' of camera' : '') + ' niet gebruiken. Sta dit toe en probeer het opnieuw.');
    });
  }

  // ---- gebeld worden ----
  function onRing(e, d) {
    if (Call.ended[d.id] || (Call.active && Call.active.id === d.id)) return;
    if (Call.incoming && Call.incoming.id === d.id) return;
    if (Call.active || Call.incoming) { signal(e.from, { type: 'busy', id: d.id }, e.dev); return; }
    var conv = +d.conv || 0;
    var inc = Call.incoming = { id: d.id, from: e.from, dev: e.dev, video: !!d.video, conv: conv, name: nameFor(e.from) };
    if (inc.name === 'Iemand') loadChats().then(function () { if (Call.incoming === inc) { inc.name = nameFor(e.from); showCall(); } }, function () {});
    inc.timeout = setTimeout(function () { if (Call.incoming === inc) dismissIncoming(); }, 60000);
    var auto = Call.autoAnswer;
    Call.autoAnswer = null;
    if (auto && auto.until > Date.now() && (!auto.conv || auto.conv === conv)) { acceptCall(inc.video); return; }
    showCall();
    sound('CALL_IN', true);
    notifyAway(inc.name, inc.video ? 'wil met je videobellen' : 'belt je', 'call', true);
  }
  function dismissIncoming() {
    var inc = Call.incoming;
    if (!inc) return;
    clearTimeout(inc.timeout);
    Call.incoming = null;
    Call.ended[inc.id] = 1;
    silence();
    if (isLumia) lumiaUntoast('call');
    showCall();
  }
  function acceptCall(withVideo) {
    var inc = Call.incoming;
    if (!inc || Call.active) return;
    clearTimeout(inc.timeout);
    silence();
    if (isLumia) lumiaUntoast('call');
    $('kIn').hidden = true;
    $('kState').textContent = 'verbinden…';
    ensureRtc().then(function (ok) {
      if (!ok) throw new Error(NO_CALL);
      return getMedia(withVideo);
    }).then(function (stream) {
      if (Call.incoming !== inc) { stopTracks(stream); return; }
      Call.incoming = null;
      var a = Call.active = {
        id: inc.id, peer: inc.from, name: inc.name, conv: inc.conv, dir: 'in', video: !!withVideo, local: stream,
        state: 'connecting', peerDev: inc.dev, pendingIce: [], started: 0, remoteVideo: false
      };
      Call.muted = false; Call.camOff = false;
      $('kLocal').srcObject = stream;
      nativeCall(true);
      showCall();
      return makePc(a).then(function () {
        signal(inc.from, { type: 'accept', id: inc.id }, inc.dev);
        signal(me.id, { type: 'taken', id: inc.id });
      });
    }).then(null, function (e) {
      log('opnemen: ' + (e && (e.name || e.message)));
      signal(inc.from, { type: 'decline', id: inc.id }, inc.dev);
      if (Call.incoming === inc) dismissIncoming();
      if (Call.active && Call.active.id === inc.id) endCall('mislukt', true);
      dialog('Bellen', e && e.message === NO_CALL ? NO_CALL : 'Skitta Lite kan je microfoon niet gebruiken. Sta dit toe en probeer het opnieuw.');
    });
  }
  function declineCall() {
    var inc = Call.incoming;
    if (!inc) return;
    signal(inc.from, { type: 'decline', id: inc.id }, inc.dev);
    signal(me.id, { type: 'taken', id: inc.id });
    dismissIncoming();
  }

  // ---- verbinding ----
  function plainDesc(d) { return { type: d.type, sdp: d.sdp }; }
  function remoteDesc(d) { return window.RTCSessionDescription ? new RTCSessionDescription(d) : d; }
  function candOf(c) {
    return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
  }
  function addIce(a, c) {
    var cand = window.RTCIceCandidate ? new RTCIceCandidate(c) : c;
    try { a.pc.addIceCandidate(cand).then(null, function () {}); } catch (e) {}
  }
  function flushIce(a) {
    var list = a.pendingIce;
    a.pendingIce = [];
    each(list, function (c) { addIce(a, c); });
  }
  function onRemoteStream(a, stream) {
    a.remote = stream;
    var au = $('kAudio');
    au.srcObject = stream;
    var p = au.play();
    if (p && p.then) p.then(null, function () {});
    if (!isLumia) {
      $('kRemote').srcObject = stream;
      var q = $('kRemote').play();
      if (q && q.then) q.then(null, function () {});
    }
  }
  function makePc(a) {
    return iceServers().then(function (servers) {
      var pc = new RTCPeerConnection({ iceServers: servers });
      a.pc = pc;
      pc.onicecandidate = function (ev) {
        if (ev.candidate && Call.active === a) signal(a.peer, { type: 'ice', id: a.id, c: candOf(ev.candidate) }, a.peerDev);
      };
      if ('ontrack' in pc) {
        pc.ontrack = function (ev) {
          if (!a.remote) {
            var s = ev.streams && ev.streams[0];
            if (!s) { s = new MediaStream(); }
            onRemoteStream(a, s);
          }
          if (a.remote.getTracks().indexOf(ev.track) < 0) try { a.remote.addTrack(ev.track); } catch (e) {}
        };
      } else {
        pc.onaddstream = function (ev) { onRemoteStream(a, ev.stream); };
      }
      pc.oniceconnectionstatechange = function () {
        if (Call.active !== a) return;
        var st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') {
          if (!a.started) {
            a.started = Date.now();
            a.tick = setInterval(function () { if (Call.active === a) $('kState').textContent = callState(); }, 1000);
          }
          a.state = 'active';
          clearTimeout(a.lost);
          showCall();
        } else if (st === 'disconnected' && a.started) {
          a.state = 'reconnecting';
          showCall();
          clearTimeout(a.lost);
          a.lost = setTimeout(function () {
            if (Call.active === a && a.state === 'reconnecting') { signal(a.peer, { type: 'hangup', id: a.id }, a.peerDev); endCall('verbinding verbroken'); }
          }, 20000);
        } else if (st === 'failed') {
          signal(a.peer, { type: 'hangup', id: a.id }, a.peerDev);
          endCall('verbinding mislukt');
        }
      };
      if (a.dir === 'out') {
        var au = a.local.getAudioTracks()[0], vi = a.local.getVideoTracks()[0];
        if (pc.addTransceiver) {
          pc.addTransceiver(au, { direction: 'sendrecv', streams: [a.local] });
          if (vi) pc.addTransceiver(vi, { direction: 'sendrecv', streams: [a.local] });
          else pc.addTransceiver('video', { direction: 'sendrecv' });
        } else if (pc.addTrack) {
          each(a.local.getTracks(), function (t) { pc.addTrack(t, a.local); });
        } else {
          pc.addStream(a.local);
        }
      }
      return pc;
    });
  }
  // Na het opnemen: de beller maakt het aanbod.
  function onAccept(e, d) {
    var a = Call.active;
    if (!a || a.id !== d.id || a.dir !== 'out') return;
    if (a.peerDev) { signal(e.from, { type: 'hangup', id: d.id }, e.dev); return; } // ander apparaat was eerder
    clearTimeout(a.timeout);
    clearInterval(a.reRing);
    a.peerDev = e.dev;
    a.state = 'connecting';
    silence();
    showCall();
    makePc(a).then(function (pc) {
      var opts = pc.addTransceiver ? undefined : { offerToReceiveAudio: true, offerToReceiveVideo: true };
      return pc.createOffer(opts).then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        signal(a.peer, { type: 'offer', id: a.id, sdp: plainDesc(pc.localDescription) }, a.peerDev);
      });
    }).then(null, function (err) {
      log('aanbod: ' + (err && err.message));
      signal(a.peer, { type: 'hangup', id: a.id }, a.peerDev);
      endCall('verbinding mislukt');
    });
  }
  function onOffer(e, d) {
    var a = Call.active;
    if (!a || a.id !== d.id || e.dev !== a.peerDev || !a.pc) return;
    var pc = a.pc;
    pc.setRemoteDescription(remoteDesc(d.sdp)).then(function () {
      var au = a.local.getAudioTracks()[0] || null, vi = a.local.getVideoTracks()[0] || null;
      if (pc.getTransceivers) {
        var jobs = [];
        each(pc.getTransceivers(), function (tx) {
          var kind = tx.receiver && tx.receiver.track && tx.receiver.track.kind;
          var track = kind === 'audio' ? au : kind === 'video' ? vi : null;
          if (kind === 'audio') au = null;
          if (kind === 'video') vi = null;
          if (track) { tx.direction = 'sendrecv'; jobs.push(tx.sender.replaceTrack(track)); }
        });
        return Promise.all(jobs);
      }
      if (pc.addTrack) each(a.local.getTracks(), function (t) { pc.addTrack(t, a.local); });
      else pc.addStream(a.local);
    }).then(function () {
      return pc.createAnswer();
    }).then(function (ans) {
      return pc.setLocalDescription(ans);
    }).then(function () {
      signal(a.peer, { type: 'answer', id: a.id, sdp: plainDesc(pc.localDescription) }, a.peerDev);
      flushIce(a);
      signal(a.peer, { type: 'media', id: a.id, video: !!a.local.getVideoTracks().length && !Call.camOff }, a.peerDev);
    }).then(null, function (err) {
      log('antwoord: ' + (err && err.message));
      signal(a.peer, { type: 'hangup', id: a.id }, a.peerDev);
      endCall('verbinding mislukt');
    });
  }
  function onAnswer(d) {
    var a = Call.active;
    if (!a || a.id !== d.id || !a.pc) return;
    a.pc.setRemoteDescription(remoteDesc(d.sdp)).then(function () {
      flushIce(a);
      signal(a.peer, { type: 'media', id: a.id, video: !!a.local.getVideoTracks().length && !Call.camOff }, a.peerDev);
    }, function (err) { log('antwoord ontvangen: ' + (err && err.message)); });
  }

  function onCallSignal(e) {
    var d = e.d || {};
    if (!me || d.enc) return; // versleuteld (oude Skitta-versie): niet te lezen
    var a = Call.active;
    switch (d.type) {
      case 'ring':
        if (e.from === me.id) return;
        onRing(e, d);
        return;
      case 'cancel':
        if (Call.incoming && Call.incoming.id === d.id) {
          var inc = Call.incoming;
          dismissIncoming();
          toast(inc.name, 'gemiste oproep', inc.conv);
          notifyAway(inc.name, 'Gemiste oproep', 'c' + inc.conv);
        }
        return;
      case 'taken':
        if (Call.incoming && Call.incoming.id === d.id) dismissIncoming();
        return;
      case 'accept': onAccept(e, d); return;
      case 'offer': onOffer(e, d); return;
      case 'answer': onAnswer(d); return;
      case 'ice':
        if (!a || a.id !== d.id || !a.pc || !d.c) return;
        if (!a.pc.remoteDescription) a.pendingIce.push(d.c); else addIce(a, d.c);
        return;
      case 'media':
        if (!a || a.id !== d.id) return;
        a.remoteVideo = !!d.video && !isLumia;
        showCall();
        return;
      case 'decline':
        if (!a || a.id !== d.id) return;
        sound('BUSY');
        endCall('geweigerd', true);
        return;
      case 'busy':
        if (!a || a.id !== d.id) return;
        sound('BUSY');
        endCall(a.name + ' is al in gesprek', true);
        return;
      case 'offline':
        if (!a || a.id !== d.id) return;
        sound('BUSY');
        endCall(a.name + ' is niet online', true);
        return;
      case 'hangup':
        if (a && a.id === d.id) endCall();
        else if (Call.incoming && Call.incoming.id === d.id) dismissIncoming();
    }
  }

  function hangup() {
    var a = Call.active;
    if (!a) return;
    signal(a.peer, { type: a.state === 'ringing' ? 'cancel' : 'hangup', id: a.id }, a.peerDev);
    endCall();
  }
  function endCall(text, silent) {
    var a = Call.active;
    if (!a) return;
    Call.ended[a.id] = 1;
    clearInterval(a.reRing); clearTimeout(a.timeout); clearInterval(a.tick); clearTimeout(a.lost);
    silence();
    if (!silent) sound('HANGUP');
    try { if (a.pc) a.pc.close(); } catch (e) {}
    stopTracks(a.local);
    $('kAudio').srcObject = null;
    $('kRemote').srcObject = null;
    $('kLocal').srcObject = null;
    nativeCall(false);
    if (a.dir === 'out') {
      var dur = a.started ? Math.round((Date.now() - a.started) / 1000) : 0;
      var failed = !dur && /niet online|mislukt/.test(text || '');
      request('POST', '/api/conversations/' + a.conv + '/messages', { kind: 'call', duration: dur, video: a.video, missed: !dur && !failed, failed: failed })
        .then(null, function () {});
    }
    // even laten zien hoe het afliep
    a.state = 'ended';
    a.endText = text || 'gesprek beëindigd';
    if (a.started) {
      var s = Math.round((Date.now() - a.started) / 1000);
      a.endText = text || ('gesprek beëindigd · ' + Math.floor(s / 60) + ':' + two(s % 60));
    }
    $('kOn').hidden = true;
    $('kState').textContent = a.endText;
    setTimeout(function () {
      if (Call.active === a) { Call.active = null; showCall(); }
    }, 1500);
  }

  $('kAccept').addEventListener('click', function () { acceptCall(false); });
  $('kAcceptV').addEventListener('click', function () { acceptCall(true); });
  $('kDecline').addEventListener('click', declineCall);
  $('kHang').addEventListener('click', hangup);
  $('kMute').addEventListener('click', function () {
    var a = Call.active;
    if (!a || !a.local) return;
    Call.muted = !Call.muted;
    each(a.local.getAudioTracks(), function (t) { t.enabled = !Call.muted; });
    showCall();
  });
  $('kCam').addEventListener('click', function () {
    var a = Call.active;
    if (!a || !a.local) return;
    Call.camOff = !Call.camOff;
    each(a.local.getVideoTracks(), function (t) { t.enabled = !Call.camOff; });
    signal(a.peer, { type: 'media', id: a.id, video: !Call.camOff }, a.peerDev);
    showCall();
  });
  $('cCall').addEventListener('click', function () { startCall(current, false); });
  $('cVCall').addEventListener('click', function () { startCall(current, true); });
  function markCallButtons() {
    var ok = rtcPossible();
    $('cCall').hidden = !ok;
    $('cVCall').hidden = !ok || isLumia;
  }
  markCallButtons();

  // ---------- toetsenbord ----------
  // iPhone: het toetsenbord verkleint alleen de visualViewport; de app volgt die, zodat het invoerveld zichtbaar blijft.
  if (window.visualViewport && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    var vv = window.visualViewport;
    var fitVV = function () {
      var app = $('app');
      app.style.height = vv.height + 'px';
      app.style.bottom = 'auto';
      window.scrollTo(0, 0);
      if (current && document.activeElement === $('cText')) scrollBottom();
    };
    vv.addEventListener('resize', fitVV);
    vv.addEventListener('scroll', function () { window.scrollTo(0, 0); });
  }
  // Lumia: het toetsenbord schuift anders de hele app omhoog; zelf ruimte maken.
  if (isLumia) {
    try {
      var pane = Windows.UI.ViewManagement.InputPane.getForCurrentView();
      pane.addEventListener('showing', function (e) {
        e.ensuredFocusedElementInView = true;
        $('app').style.bottom = e.occludedRect.height + 'px';
        if (current) scrollBottom();
      });
      pane.addEventListener('hiding', function () { $('app').style.bottom = '0'; });
    } catch (e) {}
  }

  // ---------- start ----------
  function start() {
    if (window.__liteLog) window.__liteLog(me ? 'start, ingelogd' : 'start, inlogscherm');
    if (!me) { showBase('p-login'); return; }
    showBase('p-main');
    if (pivotIndex !== 0) setPivot(0);
    $('chatList').innerHTML = '';
    var open = /^#c(\d+)$/.exec(location.hash);
    if (open) try { history.replaceState(null, '', location.pathname); } catch (e) {}
    loadChats().then(function () {
      if (open) liteOpen(+open[1]);
    }, function (e) {
      if (me) $('chatList').appendChild(el('div', 'empty', e.message));
    });
    wsOk = false;
    connect();
    nativeSession();
    lumiaSession();
    syncPush().then(null, function () {});
  }

  fillIcons(document);
  applyTheme();
  setSignup(false);
  start();
})();
