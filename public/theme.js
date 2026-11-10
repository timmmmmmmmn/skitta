// Thema meteen zetten (voor het tekenen), zodat er niets knippert.
try {
  const t = JSON.parse(localStorage.getItem('skitta.opts') || '{}').theme;
  if (t) document.documentElement.dataset.theme = t;
} catch {}
