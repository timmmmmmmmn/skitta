// Bouwt de Windows 10 Mobile-versie van Skitta: public/wp.html + public/wp/ (app.js en app.css).
// EdgeHTML 13–15 kent geen modules, veel moderne JS/CSS niet en mist PBKDF2/HKDF in WebCrypto, dus:
// alles in één script omgezet voor Edge 13, WebCrypto in pure JS (subtle.js), bellen via adapter.js (rtc.js).
// Gebruik: cd wp && npm install && node build.mjs
import * as esbuild from 'esbuild';
import swc from '@swc/core';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import customProps from 'postcss-custom-properties';
import { transform as lcss } from 'lightningcss';
import edge13 from './edge13css.mjs';

const hier = path.dirname(new URL(import.meta.url).pathname);
const pub = path.join(hier, '../public');
const uit = path.join(pub, 'wp');
fs.mkdirSync(uit, { recursive: true });

// een tekst moet precies zo vaak voorkomen als verwacht, anders is app.js veranderd en klopt de patch niet meer
const vervang = (src, oud, nieuw, wat, keer = 1) => {
  const n = src.split(oud).length - 1;
  if (n !== keer) throw new Error(`patch '${wat}': ${n}× gevonden in plaats van ${keer}×`);
  return src.split(oud).join(nieuw);
};

const wp = {
  name: 'wp',
  setup(b) {
    b.onLoad({ filter: /public\/app\.js$/ }, (a) => {
      let src = fs.readFileSync(a.path, 'utf8');
      src = vervang(src, 'const subtle = () => crypto.subtle;', 'const subtle = () => window.__wpSubtle;', 'subtle');
      src = vervang(src, 'crypto.subtle.digest(', 'window.__wpSubtle.digest(', 'digest');
      // Glisse (WebGL2) en het eiland (React) draaien niet in EdgeHTML: app.js vangt dat al op
      src = vervang(src, "import('/glisse.js')", "Promise.reject(new Error('geen glisse'))", 'glisse');
      src = vervang(src, "import('/eiland.js')", "Promise.reject(new Error('geen eiland'))", 'eiland');
      return { contents: src, loader: 'js' };
    });
  },
};

async function bundel(entry, uitNaam) {
  const r = await esbuild.build({
    entryPoints: [path.join(hier, entry)],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    outfile: path.join(uit, uitNaam),
    plugins: [wp],
    logLevel: 'warning',
  });
  // esbuild kan niet naar ES5; SWC zet de bundel om voor EdgeHTML 13 (let/const, destructuring, async)
  const js = await swc.transform(r.outputFiles[0].text, {
    // naar ES5 (doel IE 11): Chakra in Edge 14 (de Lumia) maakte na JIT-compilatie kapotte objecten met native afgeleide
    // klassen; als ES5 draait alles via het oude, beproefde pad van de engine
    // maar for…of, parameters en spread niet: SWC maakt daar try/finally-helpers van, die de Chakra-JIT niet compileert
    env: { targets: { ie: '11' }, exclude: ['transform-for-of', 'transform-parameters', 'transform-spread'] },
    jsc: { parser: { syntax: 'ecmascript' }, minify: { compress: { passes: 1 }, mangle: true } },
    minify: true,
    isModule: false,
  });
  fs.writeFileSync(path.join(uit, uitNaam), js.code);
  return js.code.length;
}
const n1 = await bundel('entry.js', 'app.js');
const n2 = await bundel('../public/theme.js', 'theme.js');

// CSS: alle vier de bladen achter elkaar, variabelen ingevuld (EdgeHTML 13/14 kent ze niet)
let css = ['app.css', 'themes.css', 'mobile.css', 'mobile-themes.css'].map((f) => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n') + '\n' + fs.readFileSync(path.join(hier, 'edge-fix.css'), 'utf8');
css = (await postcss([customProps({ preserve: true })]).process(css, { from: undefined })).css;
css = lcss({ code: Buffer.from(css), minify: true, targets: { edge: 13 << 16 }, errorRecovery: true }).code.toString();
// grid → flex, gap → marges, rekenfuncties uitgerekend: wat Edge 13/14 anders stil negeert (zie edge13css.mjs)
css = (await postcss([edge13()]).process(css, { from: undefined })).css;
css = lcss({ code: Buffer.from(css), minify: true, targets: { edge: 13 << 16 }, errorRecovery: true }).code.toString();
fs.writeFileSync(path.join(uit, 'app.css'), css);

let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
html = vervang(html, `  <link rel="stylesheet" href="/app.css">
  <link rel="stylesheet" href="/themes.css">
  <link rel="stylesheet" href="/mobile.css">
  <link rel="stylesheet" href="/mobile-themes.css">
  <script src="/theme.js"></script>
  <script src="/app.js" defer></script>`, `  <link rel="stylesheet" href="/wp/app.css">
  <script src="/wp/theme.js"></script>
  <script src="/wp/app.js" defer></script>`, 'kop');
html = html.replace('<link rel="manifest" href="/manifest.webmanifest">\n', '');
html = html.replace('<head>', () => '<head>\n  <meta http-equiv="X-UA-Compatible" content="IE=edge">\n  <script>' + fs.readFileSync(path.join(hier, 'fout.js'), 'utf8') + '</script>');
fs.writeFileSync(path.join(pub, 'wp.html'), html);
console.log('klaar:', n1, 'bytes app.js,', n2, 'bytes theme.js,', css.length, 'bytes CSS');
