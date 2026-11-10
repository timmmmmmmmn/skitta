// Versie meteen zetten (voor het tekenen), zodat er niets knippert. Oude namen omzetten.
try {
  const opts = JSON.parse(localStorage.getItem('skitta.opts') || '{}');
  const old = { xp: 'v4', blauw: 'v5xp', mac: 'mac2', plat: 'v6', modern: 'v7' };
  if (old[opts.theme]) {
    opts.theme = old[opts.theme];
    localStorage.setItem('skitta.opts', JSON.stringify(opts));
  }
  if (opts.theme) document.documentElement.dataset.theme = opts.theme;
} catch {}

// Licht/donker meteen zetten (telefoon), zodat het scherm niet eerst wit flitst.
try {
  const mode = JSON.parse(localStorage.getItem('skitta.opts') || '{}').mode || 'auto';
  let system = matchMedia('(prefers-color-scheme: dark)').matches;
  try { if (window.SkittaNative?.systemDark) system = window.SkittaNative.systemDark(); } catch {}
  const dark = mode === 'dark' || (mode === 'auto' && system);
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
} catch {}
