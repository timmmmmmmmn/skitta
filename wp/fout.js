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
  // ook naar de server (alleen in de worker-log te zien), in porties
  var sessie = Math.random().toString(36).slice(2, 8), wacht = [], t0 = Date.now(), bezig = false;
  function log(s) { if (wacht.length < 200) wacht.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + s); }
  function stuur() {
    if (bezig || !wacht.length) return;
    var x = new XMLHttpRequest(), deel = wacht.splice(0, wacht.length);
    bezig = true;
    try { x.open('POST', '/api/wplog', true); x.setRequestHeader('content-type', 'text/plain'); x.onloadend = function () { bezig = false; }; x.send(sessie + ' ' + deel.join(' | ')); } catch (e) { bezig = false; }
  }
  setInterval(stuur, 1000);
  window.__wpLog = log;
  log('start ' + navigator.userAgent + ' ' + screen.width + 'x' + screen.height);
  document.addEventListener('DOMContentLoaded', function () { log('dom klaar'); });
  window.addEventListener('load', function () {
    log('geladen');
    // na een paar seconden: wat staat er in beeld?
    setTimeout(function () {
      var zicht = [], els = document.querySelectorAll('body > *, .screen, [id]');
      for (var i = 0; i < els.length && zicht.length < 12; i++) { var e = els[i]; if (e.offsetWidth && e.offsetHeight && e.id) zicht.push(e.id); }
      log('in beeld: ' + zicht.join(',') + ' | body ' + document.body.offsetWidth + 'x' + document.body.offsetHeight + ' tekst ' + (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
    }, 4000);
  });
  window.__wpFout = function (e) { var t = (e && (e.stack || e.message)) || String(e); toon('Fout: ' + t); log('FOUT ' + String(t).slice(0, 700)); stuur(); };
  window.onerror = function (msg, bron, regel, kol, e) { var t = ((e && e.stack) || msg) + (bron ? '\n  ' + bron + ':' + regel + ':' + kol : ''); toon('Fout: ' + t); log('FOUT ' + String(t).slice(0, 700)); stuur(); };
  window.addEventListener('unhandledrejection', function (ev) { window.__wpFout(ev.reason); });
})();
