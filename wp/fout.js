// Windows 10 Mobile: fouten op het scherm (gewone ES5 in wp.html, werkt ook als app.js niet wil). Tik om te sluiten.
(function () {
  function toon(tekst) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { toon(tekst); }); return; }
    var d = document.getElementById('wpFout');
    if (!d) {
      d = document.createElement('pre');
      d.id = 'wpFout';
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:50%;overflow:auto;margin:0;padding:8px;z-index:99999;background:rgba(160,0,0,.92);color:#fff;font:12px/1.3 monospace;white-space:pre-wrap;word-break:break-all';
      d.onclick = function () { d.parentNode.removeChild(d); };
      document.body.appendChild(d);
    }
    d.textContent += tekst + '\n';
  }
  window.__wpFout = function (e) { toon('Fout: ' + ((e && (e.stack || e.message)) || String(e))); };
  window.onerror = function (msg, bron, regel, kol, e) { toon('Fout: ' + ((e && e.stack) || msg) + (bron ? '\n  ' + bron + ':' + regel + ':' + kol : '')); };
  window.addEventListener('unhandledrejection', function (ev) { window.__wpFout(ev.reason); });
})();
