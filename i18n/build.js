'use strict';
// Génère public/lang-xx.js à partir de i18n/xx.json : node i18n/build.js
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname, pub = path.join(dir, '..', 'public');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => /^[a-z]{2}\.json$/.test(x))) {
  const code = f.slice(0, 2);
  const src = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const out = {};
  for (const k of Object.keys(catalog)) if (src[k] && src[k] !== k) out[k] = src[k];   // les textes inchangés ne servent à rien
  // « Libellé : explication » : le libellé et l'explication sont aussi affichés séparément (aide, bouton « i »)
  for (const k of Object.keys(catalog)) {
    const fm = / : /.exec(k), tm = src[k] && /\s*[:：]\s*/.exec(src[k]);
    if (!fm || !tm) continue;
    const [kA, kB] = [k.slice(0, fm.index), k.slice(fm.index + 3)], [tA, tB] = [src[k].slice(0, tm.index), src[k].slice(tm.index + tm[0].length)];
    if (kA && tA && !out[kA]) out[kA] = tA;
    if (kB && tB && !out[kB]) out[kB] = tB;
  }
  fs.writeFileSync(path.join(pub, `lang-${code}.js`), `I18N.register(${JSON.stringify(code)}, ${JSON.stringify(out)});\n`);
  n++;
}
console.log(`${n} langue(s) générée(s) dans public/`);
