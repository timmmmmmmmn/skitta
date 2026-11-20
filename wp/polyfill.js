// Polyfills voor EdgeHTML 13–15 (Windows 10 Mobile). Wordt vóór de game in dezelfde bundel gezet.
import 'core-js/stable';
import 'whatwg-fetch';
import 'regenerator-runtime/runtime';

const E = Element.prototype, D = window.document;
if (!E.matches) E.matches = E.msMatchesSelector || E.webkitMatchesSelector;
if (!E.closest) E.closest = function (s) { let el = this; while (el && el.nodeType === 1) { if (el.matches(s)) return el; el = el.parentElement || el.parentNode; } return null; };
const node = (n) => (n instanceof Node ? n : D.createTextNode(String(n)));
const frag = (list) => { const f = D.createDocumentFragment(); list.forEach((n) => f.appendChild(node(n))); return f; };
for (const P of [E, DocumentFragment.prototype, Document.prototype]) {
  if (!P.append) P.append = function (...n) { this.appendChild(frag(n)); };
  if (!P.prepend) P.prepend = function (...n) { this.insertBefore(frag(n), this.firstChild); };
}
for (const P of [E, CharacterData.prototype, DocumentType.prototype]) {
  if (!P.remove) P.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  if (!P.before) P.before = function (...n) { if (this.parentNode) this.parentNode.insertBefore(frag(n), this); };
  if (!P.after) P.after = function (...n) { if (this.parentNode) this.parentNode.insertBefore(frag(n), this.nextSibling); };
  if (!P.replaceWith) P.replaceWith = function (...n) { if (this.parentNode) this.parentNode.replaceChild(frag(n), this); };
}
if (!E.toggleAttribute) E.toggleAttribute = function (a, f) { const on = f === undefined ? !this.hasAttribute(a) : !!f; if (on) this.setAttribute(a, ''); else this.removeAttribute(a); return on; };
if (window.NodeList && !NodeList.prototype.forEach) NodeList.prototype.forEach = Array.prototype.forEach;
if (window.HTMLCollection && !HTMLCollection.prototype[Symbol.iterator]) HTMLCollection.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
if (window.NodeList && !NodeList.prototype[Symbol.iterator]) NodeList.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
if (!('isConnected' in Node.prototype)) Object.defineProperty(Node.prototype, 'isConnected', { get() { return D.documentElement.contains(this.nodeType === 1 ? this : this.parentNode); } });

// classList.toggle(naam, force) en meerdere namen in add/remove
(() => {
  const t = D.createElement('i');
  t.classList.add('a', 'b');
  const C = DOMTokenList.prototype;
  if (!t.classList.contains('b')) {
    const add = C.add, rem = C.remove;
    C.add = function (...n) { n.forEach((k) => add.call(this, k)); };
    C.remove = function (...n) { n.forEach((k) => rem.call(this, k)); };
  }
  t.classList.toggle('c', false);
  if (t.classList.contains('c')) {
    const tog = C.toggle;
    C.toggle = function (k, f) { if (f === undefined) return tog.call(this, k); f ? this.add(k) : this.remove(k); return !!f; };
  }
})();

// lettertypen: EdgeHTML <17 heeft geen document.fonts
if (!D.fonts) D.fonts = { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true, addEventListener() {}, add() {} };
// afbeelding.decode()
if (window.HTMLImageElement && !HTMLImageElement.prototype.decode) {
  HTMLImageElement.prototype.decode = function () {
    const img = this;
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((ok, nee) => { img.addEventListener('load', () => ok(), { once: true }); img.addEventListener('error', nee, { once: true }); });
  };
}
// Web Animations bestaat niet in EdgeHTML: meteen naar het eindbeeld (of het begin bij fill: backwards)
if (!E.animate) {
  E.animate = function (frames, opt) {
    const o = typeof opt === 'number' ? { duration: opt } : opt || {};
    const eind = {};
    if (Array.isArray(frames)) Object.assign(eind, frames[frames.length - 1] || {});
    else for (const k in frames) eind[k] = Array.isArray(frames[k]) ? frames[k][frames[k].length - 1] : frames[k];
    const el = this;
    if (o.fill === 'forwards' || o.fill === 'both') for (const k in eind) if (k !== 'offset' && k !== 'easing') el.style[k] = eind[k];
    const duur = (o.duration || 0) + (o.delay || 0);
    let klaar;
    const a = { finished: new Promise((r) => (klaar = r)), onfinish: null, cancel() {}, finish() {}, pause() {}, play() {}, reverse() {}, playState: 'running', addEventListener(t, f) { if (t === 'finish') a.finished.then(f); } };
    setTimeout(() => { a.playState = 'finished'; klaar(a); if (a.onfinish) a.onfinish(); }, duur);
    return a;
  };
}
if (!window.requestIdleCallback) {
  window.requestIdleCallback = (f) => setTimeout(() => f({ didTimeout: false, timeRemaining: () => 8 }), 60);
  window.cancelIdleCallback = clearTimeout;
}
if (window.crypto && !crypto.randomUUID) crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
if (!window.crypto && window.msCrypto) window.crypto = window.msCrypto;

// Web Audio: decodeAudioData geeft in oude Edge geen promise terug
const AC = window.AudioContext || window.webkitAudioContext;
if (AC) {
  window.AudioContext = AC;
  const dec = AC.prototype.decodeAudioData;
  AC.prototype.decodeAudioData = function (buf, ok, nee) {
    return new Promise((res, rej) => {
      const r = dec.call(this, buf, (b) => { if (ok) ok(b); res(b); }, (e) => { if (nee) nee(e); rej(e); });
      if (r && r.then) r.then(() => {}, () => {});
    });
  };
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (OAC) { window.OfflineAudioContext = OAC; if (OAC.prototype.decodeAudioData === dec) OAC.prototype.decodeAudioData = AC.prototype.decodeAudioData; }
}
// EventTarget-opties ({ once, passive }) ondersteunt EdgeHTML 13–15 maar half: once zelf regelen
(() => {
  let onceOk = false;
  try { const o = { get once() { onceOk = true; return true; } }; window.addEventListener('x', null, o); window.removeEventListener('x', null, o); } catch (e) {}
  if (onceOk) return;
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const kaart = new WeakMap();
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (!f) return;
    const cap = typeof o === 'object' ? !!(o && o.capture) : !!o;
    if (o && typeof o === 'object' && o.once) {
      const self = this, w = function (e) { rem.call(self, t, w, cap); return typeof f === 'function' ? f.call(this, e) : f.handleEvent(e); };
      kaart.set(f, w);
      return add.call(this, t, w, cap);
    }
    return add.call(this, t, f, cap);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    const cap = typeof o === 'object' ? !!(o && o.capture) : !!o;
    rem.call(this, t, (f && kaart.get(f)) || f, cap);
  };
})();
if (!window.globalThis) window.globalThis = window;

// canvas.toBlob ontbreekt in EdgeHTML (alleen msToBlob, en dan alleen PNG)
if (window.HTMLCanvasElement && !HTMLCanvasElement.prototype.toBlob) {
  HTMLCanvasElement.prototype.toBlob = function (klaar, type, kwaliteit) {
    const c = this;
    setTimeout(() => {
      const url = c.toDataURL(type, kwaliteit), bin = atob(url.split(',')[1]), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      klaar(new Blob([u], { type: url.slice(5, url.indexOf(';')) }));
    });
  };
}
// createImageBitmap: een geladen <img> werkt overal waar een bitmap gebruikt wordt (drawImage, width/height)
if (!window.createImageBitmap) {
  window.createImageBitmap = (bron) => new Promise((ok, nee) => {
    if (!(bron instanceof Blob)) return ok(bron);
    const url = URL.createObjectURL(bron), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); img.close = () => {}; ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); nee(new Error('afbeelding kon niet geladen worden')); };
    img.src = url;
  });
}
