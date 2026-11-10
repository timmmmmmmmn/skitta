// Versie meteen zetten (voor het tekenen), zodat er niets knippert. Oude namen omzetten.
try {
  const opts = JSON.parse(localStorage.getItem('skitta.opts') || '{}');
  const old = { xp: 'v4', blauw: 'v5xp', mac: 'mac2', plat: 'v6', modern: 'v7' };
  if (old[opts.theme]) {
    opts.theme = old[opts.theme];
    localStorage.setItem('skitta.opts', JSON.stringify(opts));
  }
  if (opts.theme) document.documentElement.dataset.theme = opts.theme;
  if (opts.mtheme) document.documentElement.dataset.mtheme = opts.mtheme;
} catch {}

// Licht/donker meteen zetten (telefoon), zodat het scherm niet eerst wit flitst.
try {
  const o = JSON.parse(localStorage.getItem('skitta.opts') || '{}');
  const mode = o.mode || 'auto';
  let system = matchMedia('(prefers-color-scheme: dark)').matches;
  try { if (window.SkittaNative?.systemDark) system = window.SkittaNative.systemDark(); } catch {}
  const mt = innerWidth <= 720 ? o.mtheme || '' : '';
  const dark = mt === 'm2021' || (!mt && (mode === 'dark' || (mode === 'auto' && system)));
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
} catch {}
