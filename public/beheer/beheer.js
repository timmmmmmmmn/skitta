// Skitta Beheer: meldingen goed- of foutkeuren, gebruikers beheren, mededeling en registratie.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

async function api(method, path, data) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (data !== undefined) {
    init.body = JSON.stringify(data);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch('/api/' + path, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(out.error || 'Er ging iets mis');
    e.status = res.status;
    throw e;
  }
  return out;
}

const REASONS = { spam: 'Spam of reclame', intimidatie: 'Pesten / intimidatie', ongepast: 'Ongepaste inhoud', nep: 'Oplichting / nepaccount', anders: 'Anders' };
const when = (t) => (t ? new Date(t).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const size = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`);

const state = { tab: location.hash.slice(1) || 'overzicht', status: 'open', q: '', me: null };

function avatar(u) {
  const a = h('span', { class: `avatar ${u.avatar_id ? '' : 'none'}` });
  if (u.avatar_id) a.style.backgroundImage = `url("/api/media/${encodeURIComponent(u.avatar_id)}")`;
  return a;
}

function confirmBox(title, text, ok) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'overlay' },
      h('div', { class: 'dialog' },
        h('div', { class: 'dtitle' }, h('img', { src: '/img/favicon.png', alt: '' }), title, h('button', { class: 'dclose', onclick: () => close(false) }, '✕')),
        h('div', { class: 'dbody' }, h('p', null, text)),
        h('div', { class: 'dfoot' }, h('button', { class: 'btn default', onclick: () => close(true) }, ok), h('button', { class: 'btn', onclick: () => close(false) }, 'Annuleren'))));
    $('#layer').append(overlay);
    overlay.querySelector('.btn.default').focus();
  });
}

function infoBox(title, ...content) {
  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'dialog' },
      h('div', { class: 'dtitle' }, h('img', { src: '/img/favicon.png', alt: '' }), title, h('button', { class: 'dclose', onclick: () => overlay.remove() }, '✕')),
      h('div', { class: 'dbody' }, content),
      h('div', { class: 'dfoot' }, h('button', { class: 'btn default', onclick: () => overlay.remove() }, 'OK'))));
  $('#layer').append(overlay);
}

// ---------- Tabbladen ----------

function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  render();
}

async function render() {
  const body = $('#body');
  try {
    if (state.tab === 'meldingen') body.replaceChildren(await reportsView());
    else if (state.tab === 'gebruikers') body.replaceChildren(await usersView());
    else if (state.tab === 'instellingen') body.replaceChildren(await settingsView());
    else body.replaceChildren(await overviewView());
  } catch (e) {
    body.replaceChildren(h('p', { class: 'err', style: 'color:#d4302b' }, e.message));
  }
  refreshCount();
}

async function refreshCount() {
  try {
    const s = await api('GET', 'admin/stats');
    $('#open-count').textContent = s.open_reports ? String(s.open_reports) : '';
  } catch {}
}

// ---------- Overzicht ----------

async function overviewView() {
  const s = await api('GET', 'admin/stats');
  const stat = (n, l, alert, onclick) => h('div', { class: `stat ${alert ? 'alert' : ''}`, style: onclick ? 'cursor:pointer' : null, onclick }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  const d1Limit = 500e6;
  return h('div', null,
    h('div', { class: 'stats' },
      stat(s.open_reports, 'open meldingen', s.open_reports > 0, () => setTab('meldingen')),
      stat(s.online, 'nu online'),
      stat(s.users, 'accounts'),
      stat(s.new_users, 'nieuw (24 uur)'),
      stat(s.messages_today, 'berichten (24 uur)'),
      stat(s.messages, 'berichten totaal'),
      stat(s.conversations, 'gesprekken'),
      stat(s.blocked, 'geblokkeerd')),
    h('h3', { style: 'font-weight:600;margin:0 0 6px' }, 'Foto-opslag'),
    h('p', null, `${s.media} foto's, samen ${size(s.media_bytes)}. `,
      s.r2 ? 'Foto\'s staan in R2 (Cloudflare-opslag).' : 'Foto\'s staan nu in de database (D1). Zet R2 aan voor veel foto\'s; zie de README.'),
    s.r2 ? null : h('div', null, h('div', { class: 'bar-meter' }, h('div', { style: `width:${Math.min(100, (s.media_d1_bytes / d1Limit) * 100).toFixed(1)}%` })),
      h('p', { class: 'muted' }, `${size(s.media_d1_bytes)} van ongeveer ${size(d1Limit)} (gratis limiet per database)`)),
    h('h3', { style: 'font-weight:600;margin:16px 0 6px' }, 'Registratie'),
    h('p', null, s.registration === 'open' ? 'Iedereen kan een account maken.' : 'Nieuwe accounts maken is uitgeschakeld.', ' ', h('a', { href: '#instellingen', onclick: (e) => { e.preventDefault(); setTab('instellingen'); } }, 'Wijzigen')));
}

// ---------- Meldingen ----------

async function reportsView() {
  const list = await api('GET', `admin/reports?status=${state.status}`);
  const seg = h('div', { class: 'seg' }, [['open', 'Open'], ['goed', 'Goedgekeurd'], ['fout', 'Foutgekeurd']].map(([v, l]) =>
    h('button', { class: `btn ${state.status === v ? 'on' : ''}`, onclick: () => { state.status = v; render(); } }, l)));
  const wrap = h('div', null, h('div', { class: 'filters' }, seg, h('span', { class: 'grow' }),
    h('span', { class: 'muted' }, state.status === 'open' ? 'Oudste melding bovenaan' : 'Nieuwste bovenaan')));
  if (!list.length) {
    wrap.append(h('p', { class: 'muted' }, state.status === 'open' ? 'Geen open meldingen. 🎉' : 'Nog niets hier.'));
    return wrap;
  }
  for (const r of list) wrap.append(reportCard(r));
  return wrap;
}

function reportCard(r) {
  const msg = h('div', { class: 'report-msg' });
  if (r.media_id) msg.append(h('img', { src: `/api/admin/reports/${r.id}/media`, alt: 'Gemelde foto', loading: 'lazy' }));
  if (r.snapshot) msg.append(r.kind === 'text' ? r.snapshot : r.snapshot);
  if (!r.snapshot && !r.media_id) msg.append(h('span', { class: 'muted' }, '(leeg bericht)'));
  const card = h('div', { class: 'report' },
    h('div', { class: 'report-head' },
      h('span', { class: 'reason' }, REASONS[r.reason] || r.reason),
      r.times > 1 ? h('span', { class: 'pill red' }, `${r.times}× gemeld`) : null,
      h('span', { class: 'meta' }, `Gemeld door ${r.reporter_name || 'verwijderd account'} op ${when(r.created_at)}`)),
    h('div', { class: 'report-body' },
      h('div', null, h('b', null, r.sender_name || 'Verwijderd account'), r.sender_username ? ` (${r.sender_username})` : '',
        h('span', { class: 'muted' }, ` · verstuurd ${when(r.sent_at)}`),
        r.sender_warnings ? h('span', { class: 'pill red', style: 'margin-left:6px' }, `${r.sender_warnings} waarschuwing${r.sender_warnings === 1 ? '' : 'en'}`) : null,
        r.sender_status === 'blocked' ? h('span', { class: 'pill red', style: 'margin-left:6px' }, 'geblokkeerd') : null,
        r.deleted_at ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'door afzender verwijderd') : null),
      msg,
      r.note ? h('div', { class: 'report-note' }, h('b', null, 'Toelichting: '), r.note) : null));
  if (r.status === 'open') {
    const action = h('select', { class: 'field' },
      h('option', { value: '' }, 'Alleen het bericht verwijderen'),
      h('option', { value: 'waarschuwen' }, 'Verwijderen en afzender waarschuwen'),
      h('option', { value: 'blokkeren' }, 'Verwijderen en afzender blokkeren'));
    const decide = async (decision) => {
      if (decision === 'fout' && action.value === 'blokkeren' && !(await confirmBox('Afzender blokkeren', `${r.sender_name} wordt direct afgemeld en kan niet meer inloggen. Doorgaan?`, 'Blokkeren'))) return;
      try {
        await api('POST', `admin/reports/${r.id}`, { decision, action: decision === 'fout' ? action.value : '' });
        card.remove();
        refreshCount();
        if (!$('#body .report')) render();
      } catch (e) {
        alert(e.message);
      }
    };
    card.append(h('div', { class: 'report-actions' },
      h('button', { class: 'btn', onclick: () => decide('goed'), title: 'Het bericht is in orde en blijft staan' }, '✔ Goedkeuren'),
      h('span', { class: 'grow' }),
      action,
      h('button', { class: 'btn danger', onclick: () => decide('fout'), title: 'Het bericht wordt voor iedereen verwijderd' }, '✖ Foutkeuren')));
  } else {
    const acts = { waarschuwen: ' · afzender gewaarschuwd', blokkeren: ' · afzender geblokkeerd' };
    card.append(h('div', { class: 'report-actions' },
      h('span', { class: `verdict ${r.status}` }, r.status === 'goed' ? 'Goedgekeurd' : 'Foutgekeurd'),
      h('span', { class: 'muted' }, `door ${r.resolver_name || '?'} op ${when(r.resolved_at)}${acts[r.action] || ''}`)));
  }
  return card;
}

// ---------- Gebruikers ----------

async function usersView() {
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Zoek op naam, Skittanaam of e-mail', value: state.q, style: 'width:280px;max-width:100%' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.q = search.value;
      const table = await usersTable();
      $('#users-table').replaceWith(table);
    }, 250);
  });
  return h('div', null, h('div', { class: 'filters' }, search), await usersTable());
}

async function usersTable() {
  const list = await api('GET', `admin/users?q=${encodeURIComponent(state.q)}`);
  const rows = list.map((u) => {
    const self = u.id === state.me.id;
    const act = async (fn) => { try { await fn(); $('#users-table').replaceWith(await usersTable()); } catch (e) { alert(e.message); } };
    return h('tr', null,
      h('td', null, h('div', { class: 'nm' }, avatar(u), h('div', null, h('div', null, h('b', null, u.display_name), ' ', u.online ? h('span', { class: 'pill green' }, 'online') : null), h('div', null, u.username)))),
      h('td', { class: 'hide-sm' }, u.email),
      h('td', null,
        u.status === 'blocked' ? h('span', { class: 'pill red' }, 'geblokkeerd') : h('span', { class: 'pill' }, 'actief'), ' ',
        u.is_admin ? h('span', { class: 'pill blue' }, 'beheerder') : null, ' ',
        u.warnings ? h('span', { class: 'pill red' }, `${u.warnings}× gewaarschuwd`) : null),
      h('td', { class: 'hide-sm' }, `${u.messages} berichten · ${u.contacts} contacten`, u.rejected ? h('div', { class: 'muted' }, `${u.rejected} afgekeurd`) : null),
      h('td', { class: 'hide-sm' }, when(u.created_at), h('div', { class: 'muted' }, u.online ? 'nu online' : `gezien ${when(u.last_seen)}`)),
      h('td', null, h('div', { class: 'acts' },
        self ? h('span', { class: 'muted' }, 'jij') : [
          u.status === 'blocked'
            ? h('button', { class: 'btn', onclick: () => act(() => api('PATCH', `admin/users/${u.id}`, { status: 'active' })) }, 'Deblokkeren')
            : h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Blokkeren', `${u.display_name} blokkeren? Diegene wordt direct afgemeld.`, 'Blokkeren')) act(() => api('PATCH', `admin/users/${u.id}`, { status: 'blocked' })); } }, 'Blokkeren'),
          h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Beheerder', u.is_admin ? `${u.display_name} is dan geen beheerder meer.` : `${u.display_name} beheerder maken? Diegene kan dan ook meldingen en gebruikers beheren.`, 'OK')) act(() => api('PATCH', `admin/users/${u.id}`, { is_admin: !u.is_admin })); } }, u.is_admin ? 'Geen beheerder' : 'Beheerder maken'),
          u.warnings ? h('button', { class: 'btn', onclick: () => act(() => api('PATCH', `admin/users/${u.id}`, { warnings: 0 })) }, 'Waarschuwingen wissen') : null
        ],
        h('button', {
          class: 'btn', onclick: async () => {
            if (!(await confirmBox('Wachtwoord resetten', `Een tijdelijk wachtwoord maken voor ${u.display_name}? Diegene wordt overal afgemeld.`, 'Resetten'))) return;
            try {
              const r = await api('POST', `admin/users/${u.id}/reset-password`);
              infoBox('Tijdelijk wachtwoord', h('p', null, `Geef dit wachtwoord aan ${u.display_name}:`), h('p', { style: 'font:16px monospace;user-select:all' }, r.password), h('p', { class: 'muted' }, 'Laat diegene het daarna wijzigen via Skitta → Wachtwoord wijzigen.'));
            } catch (e) {
              alert(e.message);
            }
          }
        }, 'Wachtwoord'),
        self ? null : h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Account verwijderen', `Het account van ${u.display_name} en alles wat diegene heeft verstuurd definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`, 'Verwijderen')) act(() => api('DELETE', `admin/users/${u.id}`)); } }, 'Verwijderen'))));
  });
  return h('div', { class: 'table-wrap', id: 'users-table' }, h('table', { class: 'users' },
    h('thead', null, h('tr', null, h('th', null, 'Gebruiker'), h('th', { class: 'hide-sm' }, 'E-mail'), h('th', null, 'Status'), h('th', { class: 'hide-sm' }, 'Activiteit'), h('th', { class: 'hide-sm' }, 'Aangemaakt'), h('th', null, ''))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 6, class: 'muted' }, 'Niemand gevonden.')))));
}

// ---------- Instellingen ----------

async function settingsView() {
  const s = await api('GET', 'admin/stats');
  const ann = h('textarea', { class: 'field', rows: 4, maxlength: 2000, placeholder: 'Bijvoorbeeld: zaterdag is Skitta even offline voor onderhoud.' }, s.announcement);
  const annSaved = h('span', { class: 'saved' });
  const reg = h('select', { class: 'field' },
    h('option', { value: 'open', selected: s.registration === 'open' }, 'Open: iedereen kan een account maken'),
    h('option', { value: 'closed', selected: s.registration === 'closed' }, 'Dicht: geen nieuwe accounts'));
  const regSaved = h('span', { class: 'saved' });
  const saveSetting = async (data, label) => {
    try {
      await api('POST', 'admin/settings', data);
      label.textContent = 'Opgeslagen';
      setTimeout(() => { label.textContent = ''; }, 2500);
    } catch (e) {
      alert(e.message);
    }
  };
  return h('div', null,
    h('div', { class: 'set-row' },
      h('h3', null, 'Mededeling op Skitta Home'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Iedereen ziet dit bovenaan Skitta Home. Wie online is, krijgt meteen een melding. Laat leeg om de mededeling weg te halen.'),
      ann,
      h('div', { class: 'line' }, h('button', { class: 'btn default', onclick: () => saveSetting({ announcement: ann.value }, annSaved) }, 'Plaatsen'),
        h('button', { class: 'btn', onclick: () => { ann.value = ''; saveSetting({ announcement: '' }, annSaved); } }, 'Weghalen'), annSaved)),
    h('div', { class: 'set-row' },
      h('h3', null, 'Registratie'),
      h('div', { class: 'line' }, reg, h('button', { class: 'btn', onclick: () => saveSetting({ registration: reg.value }, regSaved) }, 'Opslaan'), regSaved)));
}

// ---------- Start ----------

async function start() {
  try {
    state.me = await api('GET', 'me');
  } catch (e) {
    $('#body').replaceChildren(h('p', null, e.status === 401 ? 'Je bent niet aangemeld. ' : e.message, e.status === 401 ? h('a', { href: '/' }, 'Aanmelden bij Skitta') : null));
    return;
  }
  if (!state.me.is_admin) {
    $('#body').replaceChildren(h('p', null, 'Deze pagina is alleen voor de beheerder van Skitta. ', h('a', { href: '/' }, 'Terug naar Skitta')));
    return;
  }
  $('#who').textContent = `Aangemeld als ${state.me.display_name} (${state.me.username})`;
  $('#tabs').hidden = false;
  for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => setTab(b.dataset.tab);
  setTab(['overzicht', 'meldingen', 'gebruikers', 'instellingen'].includes(state.tab) ? state.tab : 'overzicht');
  setInterval(refreshCount, 30000);
}

start();
