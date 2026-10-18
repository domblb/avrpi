'use strict';
// Traductions : chaque langue couvre tout le catalogue, avec les mêmes marques {} ; les fichiers public/lang-xx.js sont à jour.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'i18n');
const pub = path.join(__dirname, '..', 'public');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
const keys = Object.keys(catalog);
const count = (s) => (s.match(/\{\}/g) || []).length;
const langs = fs.readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f)).map((f) => f.slice(0, 2));

test('au moins 10 langues, hors français', () => assert.ok(langs.length >= 10, `${langs.length} langues`));

for (const l of langs) {
  test(`langue ${l} : catalogue complet et marques {} identiques`, () => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8'));
    const bad = keys.filter((k) => typeof d[k] !== 'string' || !d[k].trim() || count(k) !== count(d[k]));
    assert.deepEqual(bad.slice(0, 5), []);
  });
  test(`langue ${l} : public/lang-${l}.js généré`, () => {
    const js = fs.readFileSync(path.join(pub, `lang-${l}.js`), 'utf8');
    assert.ok(js.startsWith(`I18N.register("${l}",`));
  });
}
