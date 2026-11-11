// Brug naar Glisse (https://github.com/0kzh/glisse, MIT): Liquid Glass voor het web, met echte breking.
// Wordt met ./bouw.sh gebundeld (React zit erin), zodat de site zelf geen build-stap nodig heeft.
// Alleen de app laadt dit, en alleen op apparaten die het aankunnen; anders blijft de huidige navigatie.

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TabBar, SegmentedControl, Button } from 'glisse';

const UIT = 'glisse-uit';

// Alleen Chromium buigt de achtergrond echt (SVG-filter in backdrop-filter); elders is het gewoon blur.
export function kan() {
  try {
    if (localStorage.getItem(UIT)) return false;
  } catch (e) {}
  if (!/Chrom(?:e|ium)\//.test(navigator.userAgent)) return false;
  if (!CSS.supports('backdrop-filter', 'url(#a)')) return false;
  if ((navigator.hardwareConcurrency || 0) < 6) return false;
  if ((navigator.deviceMemory || 4) < 4) return false;
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
  return true;
}

// ---------- Wachter: hapert het scrollen met glas erop, dan voorgoed terug naar de oude navigatie ----------

const opgeven = new Set();
let gemeten = 0;
let traag = 0;
let meet = 0;

function stoppen() {
  try { localStorage.setItem(UIT, String(Date.now())); } catch (e) {}
  removeEventListener('scroll', opScroll, true);
  for (const f of [...opgeven]) f();
  opgeven.clear();
}

function opScroll() {
  // Tijdens het opstarten is alles druk; dat zegt niets over het glas.
  if (meet || gemeten >= 240 || performance.now() < 3000) return;
  let vorige = performance.now();
  let eind = vorige + 1000;
  const stap = (nu) => {
    gemeten++;
    if (nu - vorige > 25) traag++;
    vorige = nu;
    if (nu < eind && gemeten < 240) { meet = requestAnimationFrame(stap); return; }
    meet = 0;
    if (gemeten >= 60 && traag / gemeten > 0.12) stoppen();
    else if (gemeten >= 240) removeEventListener('scroll', opScroll, true);
  };
  meet = requestAnimationFrame(stap);
}
addEventListener('scroll', opScroll, { capture: true, passive: true });

const stijl = document.createElement('style');
stijl.textContent = `
.glisse-balk { position: fixed; inset: 0 auto auto 0; z-index: var(--glisse-z, 30); --lg-fill: var(--accent); }
.glisse-balk[hidden], .glisse-segment[hidden], .glisse-vervangen { display: none !important; }
.glisse-balk .lg-tab-label { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.glisse-icoon { display: grid; place-items: center; }
.glisse-icoon svg { width: 22px; height: 22px; stroke-width: 2; }
.glisse-plus .glisse-icoon svg { width: 26px; height: 26px; stroke-width: 2.4; }
.glisse-segment { --lg-fill: var(--accent); align-self: flex-start; }
html.glisse-beweegt :is(.glisse-balk, .glisse-segment) .lg-glass { --lg-filter: saturate(1.5) !important; }
.glisse-maat { position: absolute; visibility: hidden; white-space: nowrap; font-size: 13px; font-weight: 500; }
`;
document.head.append(stijl);

// ---------- Breking alleen in rust ----------
// Chromium rekent een SVG-filter in backdrop-filter elk frame opnieuw uit, niet op de GPU: tijdens scrollen
// kost dat ~10× zoveel tekenwerk en zakt de framerate. Zolang er iets beweegt houden we alleen de blur
// (goedkoop); staat alles stil, dan komt de breking terug.
let rust = 0;
function beweegt() {
  document.documentElement.classList.add('glisse-beweegt');
  clearTimeout(rust);
  rust = setTimeout(() => document.documentElement.classList.remove('glisse-beweegt'), 220);
}
addEventListener('scroll', beweegt, { capture: true, passive: true });
addEventListener('touchmove', beweegt, { capture: true, passive: true });
addEventListener('wheel', beweegt, { capture: true, passive: true });

const svg = (html) => <span className="glisse-icoon" dangerouslySetInnerHTML={{ __html: html }} />;

// Agenda/Notities: data-theme="donker"; Skitta: data-mode="dark".
const donker = () => document.documentElement.dataset.theme === 'donker' || document.documentElement.dataset.mode === 'dark';

function kleuren(host, donker) {
  host.dataset.theme = donker ? 'dark' : 'light';
}

// ---------- Zwevende navigatie ----------

// Neemt dezelfde gegevens als de native glazen balk (pill, add, tabs, active, dark, visible)
// en tekent er een Glisse-tabbalk en plusknop overheen. onNav(id) krijgt ook 'add'.
export function balk({ onNav, onStop, z }) {
  const host = document.createElement('div');
  host.className = 'glisse-balk';
  if (z) host.style.setProperty('--glisse-z', z);
  document.body.append(host);
  const root = createRoot(host);
  let laatste = null;

  const tik = (e) => {
    // Glisse klikt zelf de tab aan na loslaten; de echte klik erna houdt het tegen.
    if (e.defaultPrevented) return;
    const tab = e.target.closest('.lg-tab');
    if (!tab || !laatste) return;
    const i = [...host.querySelectorAll('.lg-tab-labels:not(.lg-tab-lensed) .lg-tab')].indexOf(tab);
    if (laatste.tabs[i]) onNav(laatste.tabs[i].id);
  };
  host.addEventListener('click', tik);

  function teken(b) {
    laatste = b;
    kleuren(host, b.dark);
    host.hidden = !b.visible || !b.pill.w;
    const breed = Math.floor((b.pill.w - 8) / b.tabs.length);
    host.style.setProperty('--lg-tab-width', `${breed}px`);
    host.style.setProperty('--lg-tab-height', `${b.pill.h - 8}px`);
    root.render(
      <>
        <TabBar
          aria-label="Navigatie"
          items={b.tabs.map((t) => ({ value: t.id, label: t.title, icon: svg(t.svg) }))}
          value={b.active}
          style={{ position: 'fixed', left: b.pill.x, top: b.pill.y }}
        />
        <Button
          className="glisse-plus"
          icon={svg(b.addSvg)}
          aria-label={b.addLabel || 'Nieuw'}
          tint="var(--accent)"
          onClick={() => onNav('add')}
          style={{ position: 'fixed', left: b.add.x, top: b.add.y, width: b.add.w, height: b.add.h, borderRadius: b.add.h / 2 }}
        />
      </>
    );
  }

  const stop = () => {
    root.unmount();
    host.remove();
    onStop?.();
  };
  opgeven.add(stop);
  // De pagina meldt de balk vaak (synchroniseren, toetsenbord, navigeren); alleen bij een echte
  // verandering opnieuw tekenen, want elke keer tekenen laat Glisse het glas opnieuw opbouwen.
  let vorige = '';
  const update = (b) => {
    const nu = JSON.stringify(b);
    if (nu === vorige) return;
    vorige = nu;
    flushSync(() => teken(b));
  };
  return { update, stop };
}

// ---------- Schuifknoppen (segmenten) ----------

// Zet een Glisse-segmentknop over een bestaande groep knoppen. De oude groep blijft de waarheid:
// de knoppen houden aria-pressed/aria-checked bij en krijgen een klik als je in Glisse kiest.
const actief = new Set();
export function segmenten(groep) {
  // Groepen die met hun paneel uit de pagina zijn verdwenen, ruimen we hier op.
  for (const s of actief) if (!s.groep.isConnected) s.stop();
  const knoppen = () => [...groep.querySelectorAll('button')];
  const keuze = () => knoppen().find((b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true');
  const host = document.createElement('div');
  host.className = 'glisse-segment';
  groep.after(host);
  groep.classList.add('glisse-vervangen');
  const root = createRoot(host);

  const maat = document.createElement('span');
  maat.className = 'glisse-maat';
  document.body.append(maat);
  const breedte = () => Math.max(84, ...knoppen().map((b) => {
    maat.textContent = b.textContent.trim();
    return Math.ceil(maat.offsetWidth) + 28;
  }));

  let vorige = '';
  const teken = () => {
    kleuren(host, donker());
    host.hidden = groep.hidden;
    host.style.setProperty('--lg-tab-width', `${breedte()}px`);
    const items = knoppen().map((b, i) => ({ value: String(i), label: b.textContent.trim() }));
    const nu = keuze();
    const sleutel = JSON.stringify([items, nu && knoppen().indexOf(nu), host.hidden, host.dataset.theme]);
    if (sleutel === vorige) return;
    vorige = sleutel;
    root.render(
      <SegmentedControl
        aria-label={groep.getAttribute('aria-label') || ''}
        items={items}
        value={nu ? String(knoppen().indexOf(nu)) : null}
        onValueChange={(v) => knoppen()[+v]?.click()}
      />
    );
  };
  const kijk = new MutationObserver(teken);
  kijk.observe(groep, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'hidden'], childList: true, characterData: true });
  kijk.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
  teken();

  const stop = () => {
    kijk.disconnect();
    root.unmount();
    host.remove();
    maat.remove();
    groep.classList.remove('glisse-vervangen');
    actief.delete(seg);
    opgeven.delete(stop);
  };
  const seg = { groep, stop };
  actief.add(seg);
  opgeven.add(stop);
  return seg;
}
