// De Hub: één Durable Object met alle WebSocket-verbindingen. Hij weet wie er online is, stuurt
// nieuwe berichten en wijzigingen door, en geeft "aan het typen" en bel-signalen (WebRTC) door.
// Hibernation: de verbindingen blijven open terwijl het object slaapt; per socket staat in de
// attachment wie het is ({ uid, dev, idle }).

import { DurableObject } from 'cloudflare:workers';
import { pushTo } from './push.js';

const tag = (uid) => `u${uid}`;

// Wat anderen van iemand zien. Onzichtbaar = offline voor anderen.
export function effectivePresence(pref, conns, idle) {
  if (!conns || pref === 'invisible') return 'offline';
  if (pref === 'online' && idle) return 'away';
  return pref;
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  sockets(uid, except) {
    return this.ctx.getWebSockets(tag(uid)).filter((ws) => ws !== except && ws.readyState === 1);
  }

  state(uid, except) {
    const list = this.sockets(uid, except);
    return { conns: list.length, idle: list.length > 0 && list.every((ws) => ws.deserializeAttachment()?.idle) };
  }

  send(uids, event, opts = {}) {
    const data = JSON.stringify(event);
    let n = 0;
    for (const uid of new Set(uids)) {
      for (const ws of this.sockets(uid)) {
        const a = ws.deserializeAttachment() || {};
        if (opts.dev && a.dev !== opts.dev) continue;
        if (opts.notDev && a.dev === opts.notDev) continue;
        try {
          ws.send(data);
          n++;
        } catch {}
      }
    }
    return n;
  }

  // ---------- Aangeroepen door de Worker (RPC) ----------

  async notify(uids, event) {
    return this.send(uids, event);
  }

  async states(uids) {
    const out = {};
    for (const uid of uids) out[uid] = this.state(uid);
    return out;
  }

  async onlineCount() {
    return new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.uid)).size;
  }

  // Iemand is geblokkeerd of verwijderd: verbindingen dicht.
  async kick(uid) {
    this.send([uid], { t: 'kick' });
    for (const ws of this.sockets(uid)) {
      try { ws.close(4001, 'kick'); } catch {}
    }
  }

  // Vertel contactpersonen (en je eigen andere apparaten) wat je status nu is.
  async presenceChanged(uid, except) {
    const user = await this.env.DB.prepare('SELECT presence FROM users WHERE id = ?').bind(uid).first();
    if (!user) return;
    const { conns, idle } = this.state(uid, except);
    const p = effectivePresence(user.presence, conns, idle);
    const { results } = await this.env.DB.prepare("SELECT contact_id FROM contacts WHERE user_id = ? AND state = 'ok'").bind(uid).all();
    this.send(results.map((r) => r.contact_id), { t: 'presence', u: uid, p });
    this.send([uid], { t: 'presence', u: uid, p, own: user.presence, idle });
    if (!conns) await this.env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), uid).run();
  }

  // ---------- WebSockets ----------

  async fetch(request) {
    const uid = Number(request.headers.get('x-skitta-user'));
    const dev = String(request.headers.get('x-skitta-dev') || '').slice(0, 40);
    if (!uid || request.headers.get('upgrade') !== 'websocket') return new Response('Nee', { status: 400 });
    const [client, server] = Object.values(new WebSocketPair());
    const before = this.state(uid);
    this.ctx.acceptWebSocket(server, [tag(uid)]);
    server.serializeAttachment({ uid, dev, idle: false });
    if (!before.conns || before.idle) this.ctx.waitUntil(this.presenceChanged(uid));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a?.uid || typeof raw !== 'string' || raw.length > 64000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'idle') {
      const before = this.state(a.uid).idle;
      ws.serializeAttachment({ ...a, idle: !!m.on });
      if (this.state(a.uid).idle !== before) await this.presenceChanged(a.uid);
      return;
    }

    if (m.t === 'typing') {
      const c = Number(m.c);
      const { results } = await this.env.DB.prepare(
        'SELECT user_id FROM members WHERE conversation_id = ? AND left_at IS NULL'
      ).bind(c).all();
      const ids = results.map((r) => r.user_id);
      if (!ids.includes(a.uid)) return;
      this.send(ids.filter((id) => id !== a.uid), { t: 'typing', c, u: a.uid, on: m.on !== false });
      return;
    }

    // Bel-signalen: alleen tussen geaccepteerde contactpersonen, of naar je eigen andere apparaten.
    if (m.t === 'call') {
      const to = Number(m.to);
      if (!to || !m.d || typeof m.d !== 'object') return;
      if (to !== a.uid) {
        const ok = await this.env.DB.prepare(
          "SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? AND state = 'ok'"
        ).bind(to, a.uid).first();
        if (!ok) return;
      }
      const event = { t: 'call', from: a.uid, dev: a.dev, d: m.d };
      const n = this.send([to], event, to === a.uid ? { notDev: a.dev } : { dev: m.dev || undefined });
      if (!n && m.d.type === 'ring' && to !== a.uid) await this.ringAway(ws, a.uid, to, m.d);
    }
  }

  // Niemand van de gebelde persoon is online: met een pushmelding wakker maken (één keer per oproep).
  // De beller blijft het belsignaal herhalen, dus wie de app binnen de beltijd opent, kan opnemen.
  async ringAway(ws, from, to, d) {
    const subs = await this.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').bind(to).first();
    if (!subs.n) {
      ws.send(JSON.stringify({ t: 'call', from: to, d: { type: 'offline', id: d.id } }));
      return;
    }
    this.pushed ||= new Set();
    if (this.pushed.has(d.id)) return;
    this.pushed.add(d.id);
    const caller = await this.env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(from).first();
    this.ctx.waitUntil(pushTo(this.env, [to], {
      t: 'call', title: caller?.display_name || 'Skitta', body: d.video ? 'wil met je videobellen' : 'belt je', tag: 'call', c: Number(d.conv) || 0
    }, { ttl: 45 }).catch(() => {}));
  }

  async webSocketClose(ws, code) {
    const a = ws.deserializeAttachment();
    try { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, ''); } catch {}
    if (a?.uid && !this.state(a.uid, ws).conns) await this.presenceChanged(a.uid, ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws, 1011);
  }
}
