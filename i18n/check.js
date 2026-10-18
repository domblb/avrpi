'use strict';
// Vérifie les traductions : node i18n/check.js [langue …]   (sans argument : toutes les langues présentes)
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
const keys = Object.keys(catalog);
const count = (s) => (s.match(/\{\}/g) || []).length;
const langs = process.argv.length > 2 ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2));
let bad = 0;
for (const l of langs) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8')); } catch (e) { console.log(`${l}: JSON invalide (${e.message})`); bad++; continue; }
  const problems = [];
  for (const k of keys) {
    const v = d[k];
    if (typeof v !== 'string' || !v.trim()) { problems.push(`manquante : ${k.slice(0, 60)}`); continue; }
    if (count(k) !== count(v)) problems.push(`{} différent : ${k.slice(0, 50)} -> ${v.slice(0, 50)}`);
  }
  for (const k of Object.keys(d)) if (!(k in catalog)) problems.push(`clé inconnue : ${k.slice(0, 60)}`);
  console.log(`${l}: ${problems.length ? problems.length + ' problème(s)' : 'OK'} (${keys.length} clés)`);
  problems.slice(0, 15).forEach((p) => console.log('   ' + p));
  bad += problems.length ? 1 : 0;
}
process.exit(bad ? 1 : 0);
