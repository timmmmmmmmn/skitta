// Skitta Lite: fouten naar de server sturen (alleen te zien in de worker-log, `wrangler tail`), niets opgeslagen.
// Losse file vóór app.js, zodat ook een fout in app.js zelf binnenkomt.
(function () {
  var sent = 0;
  function send(s) {
    if (sent++ > 20) return;
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/wplog', true);
      x.setRequestHeader('Content-Type', 'text/plain');
      x.send('lite ' + location.host + ' ' + navigator.userAgent + ' | ' + s);
    } catch (e) {}
  }
  window.onerror = function (msg, src, line, col) { send(msg + ' @ ' + src + ':' + line + ':' + col); };
  window.addEventListener('unhandledrejection', function (e) { send('promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
  window.__liteLog = send;
})();
