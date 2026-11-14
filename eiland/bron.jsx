// Brug tussen de app (gewoon JavaScript, zonder React) en islandcn (island/, MIT): een Dynamic Island-achtige
// pil bovenin beeld. De app beschrijft de inhoud als gewone gegevens, deze brug maakt er React van.
//
//   const e = maak({ top: 'env(safe-area-inset-top)' });
//   e.toon('gesprek', { label: 'In gesprek', klein: { links: ..., rechts: '0:42' }, groot: { ... }, klik: () => ... });
//   e.toon('gesprek', { klein: { rechts: '0:43' } });   // zelfde id = bijwerken
//   e.weg('gesprek');
//
// Een vak (links, rechts, midden, onder, mini) is:
//   'tekst' | 123                         gewone tekst
//   () => Node                            een eigen DOM-element (avatar, icoon), één keer aangemaakt
//   [vak, vak, ...]                       naast elkaar
//   { kolom: [vak, ...] }                 onder elkaar
//   { tekst, stijl }                      tekst met eigen opmaak (stijl = CSS-object)
//   { html }                              eigen (vertrouwde) HTML, zoals een svg-icoon
//   { knop: vak, kleur, klik, label }     ronde knop
//   { balk: 0..1, kleur }                 voortgangsbalk
//   { ring: 0..1, kleur }                 voortgangsringetje (voor in de kleine pil)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Island, IslandProgress, IslandProvider, useIsland, useIslandActions } from './island/index.ts';

function Dom({ maak }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let node = null;
    try { node = maak(); } catch {}
    if (node) el.replaceChildren(node);
  }, [maak]);
  return <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center' }} />;
}

function Ring({ waarde, kleur = '#30D158' }) {
  const r = 8, omtrek = 2 * Math.PI * r, v = Math.max(0, Math.min(1, waarde));
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ display: 'block' }}>
      <circle cx="11" cy="11" r={r} fill="none" stroke="#414141" strokeWidth="3" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={kleur} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={omtrek} strokeDashoffset={omtrek * (1 - v)} transform="rotate(-90 11 11)"
        style={{ transition: 'stroke-dashoffset .4s ease' }} />
    </svg>
  );
}

function Vak({ v }) {
  if (v == null || v === false) return null;
  if (typeof v === 'string' || typeof v === 'number') return <span>{v}</span>;
  if (typeof v === 'function') return <Dom maak={v} />;
  if (Array.isArray(v)) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{v.map((x, i) => <Vak key={i} v={x} />)}</span>;
  }
  if (v.kolom) {
    return <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, ...v.stijl }}>{v.kolom.map((x, i) => <Vak key={i} v={x} />)}</span>;
  }
  if (v.html != null) return <span style={{ display: 'inline-flex', alignItems: 'center', ...v.stijl }} dangerouslySetInnerHTML={{ __html: v.html }} />;
  if (v.knop !== undefined) {
    return (
      <button type="button" aria-label={v.label} onClick={(e) => { e.stopPropagation(); v.klik?.(); }}
        style={{ width: 46, height: 46, borderRadius: '50%', border: 0, padding: 0, margin: 0, display: 'grid', placeItems: 'center',
          background: v.kleur || '#3a3a3c', color: '#fff', cursor: 'pointer', font: 'inherit', ...v.stijl }}>
        <Vak v={v.knop} />
      </button>
    );
  }
  if (v.balk !== undefined) return <IslandProgress value={v.balk} color={v.kleur} height={6} />;
  if (v.ring !== undefined) return <Ring waarde={v.ring} kleur={v.kleur} />;
  if (v.tekst !== undefined) return <span style={v.stijl}>{v.tekst}</span>;
  return null;
}

// Nederlandse vaknamen → die van islandcn; alleen meegegeven vakken, zodat bijwerken de rest laat staan.
const vakken = (o, namen) => {
  if (!o) return undefined;
  const uit = {};
  for (const [nl, en] of namen) if (nl in o) uit[en] = <Vak v={o[nl]} />;
  return uit;
};

function omzetten(spec) {
  const uit = {};
  if ('label' in spec) uit.label = spec.label;
  if ('prioriteit' in spec) uit.priority = spec.prioriteit;
  if ('groep' in spec) uit.group = spec.groep;
  if ('alert' in spec) uit.alert = spec.alert;
  if ('klik' in spec) uit.onPress = spec.klik;
  if (spec.overgang) uit.transition = spec.overgang === 'wissel' ? 'crossfade' : 'update';
  if (spec.klein) uit.compact = vakken(spec.klein, [['links', 'leading'], ['rechts', 'trailing']]);
  if ('mini' in spec) uit.minimal = <Vak v={spec.mini} />;
  if (spec.groot) uit.expanded = vakken(spec.groot, [['links', 'leading'], ['midden', 'center'], ['rechts', 'trailing'], ['onder', 'bottom']]);
  return uit;
}

// De pil staat er alleen als er iets te tonen is: zonder activiteit verdwijnt ook de lege rustpil.
function Zichtbaar({ children }) {
  const island = useIsland();
  const leeg = island.activities.length === 0;
  const [weg, setWeg] = useState(true);
  useEffect(() => {
    if (!leeg) { setWeg(false); return; }
    const t = setTimeout(() => setWeg(true), 900);
    return () => clearTimeout(t);
  }, [leeg]);
  return <div style={{ display: weg ? 'none' : 'contents' }}>{children}</div>;
}

function Brug({ klaar }) {
  const api = useIslandActions();
  useEffect(() => { klaar(api); }, [api, klaar]);
  return null;
}

// metrics/motion: overrides van islandcn (zie island/metrics.ts en island/motion.ts).
export function maak({ top = '0px', z = 9000, metrics, motion, plek = document.body } = {}) {
  const el = document.createElement('div');
  el.className = 'eiland';
  plek.append(el);
  let api = null;
  const wacht = [];
  const ids = new Set();
  const doe = (f) => (api ? f(api) : wacht.push(f));
  const klaar = (a) => { api = a; wacht.splice(0).forEach((f) => f(a)); };
  createRoot(el).render(
    <IslandProvider metrics={metrics} motion={motion}>
      <Brug klaar={klaar} />
      <Zichtbaar>
        <Island placement="viewport" label="Meldingen" keyline="off" style={{ top, zIndex: z }} />
      </Zichtbaar>
    </IslandProvider>
  );
  return {
    toon(id, spec = {}) {
      const nieuw = !ids.has(id);
      ids.add(id);
      const o = omzetten(spec);
      doe((a) => (nieuw ? a.start({ id, ...o }) : a.update(id, o)));
    },
    weg(id) {
      if (!ids.delete(id)) return;
      doe((a) => a.end(id));
    },
    open(id) { doe((a) => a.expand(id)); },
    dicht() { doe((a) => a.collapse()); },
    heeft: (id) => ids.has(id),
    get stand() { return api?.presentation || 'idle'; }
  };
}
