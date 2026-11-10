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
