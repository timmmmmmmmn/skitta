// Zet moderne CSS om naar wat EdgeHTML 13 (Windows 10 Mobile) begrijpt. Edge 13 negeert stil: display:grid, gap,
// min()/max()/clamp(), env(), aspect-ratio, inset, place-*, en hele regels met een onbekende selector. Daardoor viel het
// menu van Jens Run uit elkaar. Hier: grid wordt flexbox, gap wordt marges, rekenfuncties worden uitgerekend voor het
// scherm van de Lumia (320×533 CSS-pixels). Wat overblijft is CSS die Chrome en Edge 13 hetzelfde tekenen, dus een
// screenshot in Chrome laat zien hoe het op de telefoon wordt.
import postcss from 'postcss';

const VW = 320, VH = 533, REM = 16;

// ---------- rekenen: min/max/clamp/calc met px, vw, vh, rem/em ----------
function rekenWaarde(src) {
  let i = 0;
  const ws = () => { while (src[i] === ' ') i++; };
  function som() {
    let a = product();
    for (;;) {
      ws();
      const o = src[i];
      if (o !== '+' && o !== '-') return a;
      i++;
      const b = product();
      a = a && b && a.px !== undefined && b.px !== undefined ? { px: o === '+' ? a.px + b.px : a.px - b.px } : a && b && a.n !== undefined && b.n !== undefined ? { n: o === '+' ? a.n + b.n : a.n - b.n } : null;
    }
  }
  function product() {
    let a = enkel();
    for (;;) {
      ws();
      const o = src[i];
      if (o !== '*' && o !== '/') return a;
      i++;
      const b = enkel();
      if (!a || !b) a = null;
      else if (o === '*') a = a.n !== undefined && b.px !== undefined ? { px: a.n * b.px } : a.px !== undefined && b.n !== undefined ? { px: a.px * b.n } : a.n !== undefined && b.n !== undefined ? { n: a.n * b.n } : null;
      else a = a.px !== undefined && b.n ? { px: a.px / b.n } : a.n !== undefined && b.n ? { n: a.n / b.n } : null;
    }
  }
  function args() {
    const l = [];
    for (;;) { l.push(som()); ws(); if (src[i] === ',') { i++; continue; } if (src[i] === ')') { i++; return l; } throw new Error('verwacht ) in ' + src); }
  }
  function enkel() {
    ws();
    if (src[i] === '(') { i++; const v = som(); ws(); if (src[i] !== ')') throw new Error('verwacht ) in ' + src); i++; return v; }
    const f = /^(min|max|clamp|calc)\(/.exec(src.slice(i));
    if (f) {
      i += f[0].length;
      const l = args();
      if (l.some((x) => !x)) return null;
      if (f[1] === 'calc') return l[0];
      if (l.some((x) => x.px === undefined)) return l.every((x) => x.n !== undefined) ? { n: Math[f[1] === 'clamp' ? 'max' : f[1]](...l.map((x) => x.n)) } : null;
      const p = l.map((x) => x.px);
      return { px: f[1] === 'min' ? Math.min(...p) : f[1] === 'max' ? Math.max(...p) : Math.max(p[0], Math.min(p[1], p[2])) };
    }
    const m = /^(-?[\d.]+(?:e-?\d+)?)([a-z%]*)/i.exec(src.slice(i));
    if (!m) { // onbekend (bv. var() of een ander woord): niet uit te rekenen; tot het einde van dit argument overslaan
      let diep = 0;
      while (i < src.length) { const c = src[i]; if (c === '(') diep++; else if (c === ')') { if (!diep) break; diep--; } else if (c === ',' && !diep) break; i++; }
      return null;
    }
    i += m[0].length;
    const v = parseFloat(m[1]), u = m[2].toLowerCase();
    if (!u) return { n: v };
    const k = { px: 1, vw: VW / 100, vh: VH / 100, dvh: VH / 100, svh: VH / 100, lvh: VH / 100, vmin: Math.min(VW, VH) / 100, vmax: Math.max(VW, VH) / 100, rem: REM, em: REM }[u];
    return k === undefined ? null : { px: v * k };
  }
  const v = som();
  ws();
  return i === src.length ? v : null;
}
// één functie-aanroep vanaf positie s (src[s..] begint met naam + '('): einde na de bijbehorende ')'
function eindVan(src, s) {
  let diep = 0;
  for (let i = src.indexOf('(', s); i < src.length; i++) { if (src[i] === '(') diep++; else if (src[i] === ')' && !--diep) return i + 1; }
  return src.length;
}
// splitst op komma's op het hoogste niveau
function splitsArgs(s) {
  const uit = []; let diep = 0, b = 0;
  for (let i = 0; i < s.length; i++) { if (s[i] === '(') diep++; else if (s[i] === ')') diep--; else if (s[i] === ',' && !diep) { uit.push(s.slice(b, i).trim()); b = i + 1; } }
  uit.push(s.slice(b).trim());
  return uit;
}
const px = (n) => `${Math.round(n * 100) / 100}px`;
const onopgelost = [];
function waardeOm(v, waar) {
  // env(naam, terugval) → terugval, env(naam) → 0px
  for (let s; (s = v.search(/\benv\(/)) >= 0;) {
    const e = eindVan(v, s), a = splitsArgs(v.slice(s + 4, e - 1));
    v = v.slice(0, s) + (a[1] || '0px') + v.slice(e);
  }
  v = v.replace(/(\d)[ds]vh\b/g, '$1vh').replace(/(\d)lvh\b/g, '$1vh');
  // min/max/clamp (ook binnen calc): uitrekenen; lukt dat niet (procenten), dan een redelijke keuze
  for (let n = 0; n < 50; n++) {
    const m = /\b(min|max|clamp)\(/.exec(v);
    if (!m) break;
    // de buitenste calc() eromheen meenemen als die er is
    let s = m.index, e = eindVan(v, s);
    const voor = v.slice(0, s), calc = voor.lastIndexOf('calc(');
    if (calc >= 0 && eindVan(v, calc) >= e) { s = calc; e = eindVan(v, calc); }
    const stuk = v.slice(s, e);
    let r = null;
    try { r = rekenWaarde(stuk); } catch (x) { r = null; }
    if (r && r.px !== undefined) v = v.slice(0, s) + px(r.px) + v.slice(e);
    else if (r && r.n !== undefined) v = v.slice(0, s) + String(Math.round(r.n * 1000) / 1000) + v.slice(e);
    else {
      // binnenste min/max/clamp: met procenten kiezen we het vloeiende argument (op een smalle telefoon wint dat meestal)
      const s2 = m.index, e2 = eindVan(v, s2), a = splitsArgs(v.slice(s2 + m[1].length + 1, e2 - 1));
      const kies = m[1] === 'clamp' ? a[1] : a.find((x) => /%/.test(x)) || a[0];
      onopgelost.push(`${waar}: ${v.slice(s2, e2)} → ${kies}`);
      v = v.slice(0, s2) + (/[\s+*/-]/.test(kies.replace(/^-/, '')) && !/^[a-z-]+\(/.test(kies) ? `calc(${kies})` : kies) + v.slice(e2);
    }
  }
  // geneste calc() kent Edge 13 niet: de binnenste wordt een gewoon haakje
  for (let n = 0; n < 20; n++) {
    const s = v.indexOf('calc(');
    if (s < 0) break;
    const e = eindVan(v, s), binnen = v.slice(s + 5, e - 1);
    if (!/calc\(/.test(binnen)) break;
    v = v.slice(0, s + 5) + binnen.replace(/calc\(/g, '(') + v.slice(e - 1);
  }
  return v;
}

// ---------- selectors die Edge 13 niet kent: een onbekende maakt de hele regel ongeldig ----------
const ONBEKEND = /:focus-visible|:focus-within|::placeholder|::-webkit-|:-webkit-|::-moz-|:-moz-|:is\(|:where\(|:has\(|::backdrop|:placeholder-shown/;
const ENKEL = /^(\.[\w-]+|#[\w-]+|[\w-]+|\*|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?)$/;
const complexeNot = (s) => [...s.matchAll(/:not\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].some((m) => !ENKEL.test(m[1].trim()));

// ---------- grid en gap ----------
function lees(rule) {
  const d = {};
  rule.each((x) => { if (x.type === 'decl') d[x.prop] = x.value; });
  return d;
}
function gaps(d) {
  let rg = null, cg = null;
  if (d.gap) { const p = d.gap.split(/\s+(?![^(]*\))/); rg = p[0]; cg = p[1] || p[0]; }
  if (d['grid-gap']) { const p = d['grid-gap'].split(/\s+(?![^(]*\))/); rg = p[0]; cg = p[1] || p[0]; }
  if (d['row-gap']) rg = d['row-gap'];
  if (d['column-gap']) cg = d['column-gap'];
  return { rg, cg };
}
// kolommen uit grid-template-columns: [{ soort: 'fr'|'px'|'auto', w }] of { vul: minimum }
function kolommen(t) {
  if (!t || t === 'none') return null;
  const vul = /repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(\s*([\d.]+)px/.exec(t);
  if (vul) return { vul: parseFloat(vul[1]) };
  t = t.replace(/repeat\(\s*(\d+)\s*,\s*([^()]+|minmax\([^)]*\))\)/g, (_, n, x) => Array(+n).fill(x.trim()).join(' '));
  return t.split(/\s+(?![^(]*\))/).filter(Boolean).map((x) => {
    const mm = /^minmax\(([^,]+),\s*(.+)\)$/.exec(x);
    if (mm) x = mm[2].trim();
    if (/fr$/.test(x)) return { soort: 'fr', w: parseFloat(x) || 1 };
    if (/^[\d.]+px$/.test(x)) return { soort: 'px', w: x };
    return { soort: 'auto' };
  });
}

export default function edge13() {
  return {
    postcssPlugin: 'edge13',
    Once(root, { Rule, Declaration }) {
      // 1. selectors opschonen
      root.walkRules((r) => {
        if (r.parent && r.parent.type === 'atrule' && /keyframes/.test(r.parent.name)) return;
        const l = r.selectors.filter((s) => !ONBEKEND.test(s) && !complexeNot(s));
        if (!l.length) r.remove(); else if (l.length !== r.selectors.length) r.selectors = l;
      });
      // 2. waarden en eigenschappen
      root.walkDecls((d) => {
        const v = waardeOm(d.value, d.parent.selector || '');
        if (v !== d.value) d.value = v;
        if (d.prop === 'inset') {
          const p = d.value.split(/\s+(?![^(]*\))/), [t, r = t, b = t, l = r] = p;
          d.replaceWith([['top', t], ['right', r], ['bottom', b], ['left', l]].map(([prop, value]) => new Declaration({ prop, value })));
        } else if (d.prop === 'place-items' || d.prop === 'place-content' || d.prop === 'place-self') {
          const [a, j = a] = d.value.split(/\s+/), soort = d.prop.slice(6);
          d.replaceWith([new Declaration({ prop: 'align-' + soort, value: a }), new Declaration({ prop: 'justify-' + soort, value: j })]);
        }
      });
      // 3. grid → flex, gap → marges. Eerst per selector verzamelen wat de basis is (buiten @media)
      const basis = new Map();
      root.walkRules((r) => {
        if (r.parent.type === 'atrule' && /keyframes/.test(r.parent.name)) return;
        const d = lees(r);
        for (const s of r.selectors) {
          const b = basis.get(s) || {};
          if (r.parent.type === 'root' || !b.display) for (const k of ['display', 'grid-template-columns', 'grid-auto-flow', 'flex-direction', 'flex-flow', 'flex-wrap', 'gap', 'grid-gap', 'row-gap', 'column-gap', 'justify-items', 'align-items']) if (d[k] !== undefined && (r.parent.type === 'root' || b[k] === undefined)) b[k] = d[k];
          basis.set(s, b);
        }
      });
      const nieuw = [];
      root.walkRules((r) => {
        if (r.parent.type === 'atrule' && /keyframes/.test(r.parent.name)) return;
        const d = lees(r);
        const raakt = d.display || d['grid-template-columns'] || d.gap || d['grid-gap'] || d['row-gap'] || d['column-gap'] || d['grid-auto-flow'] || d['flex-direction'] || d['flex-wrap'] || d['flex-flow'];
        if (!raakt) return;
        const kind = [];
        const inMedia = r.parent.type === 'atrule';
        for (const s of r.selectors) {
          const b = basis.get(s) || {};
          // heeft de game voor deze selector later zelf een flex-versie, dan geldt die (zoals .slider)
          const isGrid = /grid/.test(d.display || b.display || '') && (inMedia || !d.display || /grid/.test(b.display || ''));
          const e = Object.assign({}, b, d);
          const isFlex = !isGrid && /flex/.test(e.display || '');
          const { rg, cg } = gaps(e);
          // lage specificiteit (> * en > * + *), zodat de eigen regels van de kinderen blijven winnen
          const alle = `${s} > *`, naEerste = `${s} > * + *`;
          if (isGrid) {
            const k = kolommen(e['grid-template-columns']);
            const rij = !k && /column/.test(e['grid-auto-flow'] || '');
            const n = k ? (k.vul ? Math.max(1, Math.floor((VW - 32 + parseFloat(cg || 0)) / (k.vul + parseFloat(cg || 0)))) : k.length) : 1;
            if (rij) {
              r.__flex = { 'flex-direction': 'row', 'flex-wrap': 'nowrap' };
              kind.push([alle, { flex: '1 1 0px', 'min-width': '0', 'margin-top': '0' }]);
              kind.push([naEerste, { 'margin-left': cg || '0' }]);
            } else if (n === 1) {
              r.__flex = { 'flex-direction': 'column', 'flex-wrap': 'nowrap' };
              kind.push([alle, { 'margin-left': '0' }]);
              kind.push([naEerste, { 'margin-top': rg || '0' }]);
              const ji = e['justify-items'], ai = e['align-items'];
              r.__flex['align-items'] = ji && ji !== 'stretch' && ji !== 'normal' ? (ji === 'start' ? 'flex-start' : ji === 'end' ? 'flex-end' : ji) : 'stretch';
              if (ai === 'center') r.__flex['justify-content'] = 'center';
            } else {
              const sporen = k.vul ? Array(n).fill({ soort: 'fr', w: 1 }) : k;
              const gelijk = sporen.every((x) => x.soort === 'fr' && x.w === sporen[0].w);
              const ai = e['align-items'];
              r.__flex = { 'flex-direction': 'row', 'flex-wrap': gelijk ? 'wrap' : 'nowrap' };
              if (ai && ai !== 'normal') r.__flex['align-items'] = ai === 'start' ? 'flex-start' : ai === 'end' ? 'flex-end' : ai;
              if (gelijk) {
                // n gelijke kolommen: vaste breedte, nieuwe rij na elke n
                kind.push([alle, { flex: '0 0 auto', width: `calc((100% - ${n - 1} * ${cg || '0px'}) / ${n})`, 'min-width': '0', 'margin-left': cg || '0', 'margin-top': '0' }]);
                kind.push([`${s} > :nth-child(${n}n+1)`, { 'margin-left': '0' }]);
                if (rg) kind.push([`${s} > :nth-child(n+${n + 1})`, { 'margin-top': rg }]);
              } else {
                // gemengde sporen (bv. 54px 1fr auto): één rij
                kind.push([alle, { flex: '0 1 auto', 'min-width': '0', 'margin-top': '0' }]);
                kind.push([naEerste, { 'margin-left': cg || '0' }]);
                sporen.forEach((x, j) => {
                  const sel = `${s} > :nth-child(${j + 1})`;
                  if (x.soort === 'fr') kind.push([sel, { 'flex-grow': String(x.w) }]);
                  else if (x.soort === 'px') kind.push([sel, { 'flex-shrink': '0', width: x.w }]);
                });
              }
            }
          } else if (isFlex && (rg || cg || inMedia)) {
            const ff = e['flex-flow'] || '', dir = e['flex-direction'] || (/column/.test(ff) ? 'column' : 'row');
            const w = e['flex-wrap'] || ff;
            const wrap = /wrap/.test(w) && !/nowrap/.test(w);
            if (!rg && !cg) continue;
            if (wrap) kind.push([alle, { 'margin-right': cg || '0', 'margin-bottom': rg || '0' }]);
            else if (/column/.test(dir)) kind.push([naEerste, { 'margin-top': rg || '0', 'margin-left': '0' }]);
            else kind.push([naEerste, /reverse/.test(dir) ? { 'margin-right': cg || '0', 'margin-top': '0' } : { 'margin-left': cg || '0', 'margin-top': '0' }]);
          }
        }
        if (kind.length) nieuw.push([r, kind]);
      });
      // de container zelf: grid-declaraties eruit, flex erin
      root.walkRules((r) => {
        r.walkDecls((d) => {
          if (d.prop === 'display' && /grid/.test(d.value)) d.value = d.value === 'inline-grid' ? 'inline-flex' : 'flex';
          else if (/^(gap|row-gap|column-gap|grid-gap|grid-template-columns|grid-template-rows|grid-template-areas|grid-template|grid-auto-flow|grid-auto-rows|grid-auto-columns|justify-items|aspect-ratio)$/.test(d.prop)) d.remove();
          else if (/^(grid-column|grid-row|grid-area)$/.test(d.prop)) {
            // over de hele breedte: dan een eigen rij in de flex-versie
            if (d.prop === 'grid-column' && /^1\s*\/\s*-1$/.test(d.value.trim())) d.replaceWith([new Declaration({ prop: 'flex', value: '0 0 100%' }), new Declaration({ prop: 'width', value: '100%' }), new Declaration({ prop: 'margin-left', value: '0' })]);
            else d.remove();
          }
        });
        if (r.__flex) for (const [prop, value] of Object.entries(r.__flex)) r.append(new Declaration({ prop, value }));
      });
      for (const [r, kind] of nieuw.reverse()) {
        let na = r;
        for (const [selector, decls] of kind) {
          const k = new Rule({ selector });
          for (const [prop, value] of Object.entries(decls)) k.append(new Declaration({ prop, value }));
          na.after(k);
          na = k;
        }
      }
    },
  };
}
edge13.postcss = true;
export { onopgelost };
