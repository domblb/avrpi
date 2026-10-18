'use strict';
// Journal des erreurs et rapport de diagnostic (public/journal.js, logique sans DOM).
const test = require('node:test');
const assert = require('node:assert');
const Diag = require('../public/journal');

test('journal : ajout, regroupement des répétitions, non-lues, plafond, persistance', () => {
  let t = 1000, saved = null;
  const j = Diag.createJournal({ load: () => [], save: (l) => { saved = l; }, now: () => t });
  j.add({ title: 'A', raw: 'x' });
  t += 500; j.add({ title: 'A', raw: 'x' });          // répétition rapprochée : même ligne
  assert.equal(j.list().length, 1);
  assert.equal(j.list()[0].n, 2);
  assert.equal(j.unread, 1);
  t += 10000; j.add({ title: 'A', raw: 'x' });        // plus tard : nouvelle ligne
  assert.equal(j.list().length, 2);
  j.markRead();
  assert.equal(j.unread, 0);
  for (let i = 0; i < Diag.MAX + 20; i++) { t += 5000; j.add({ title: `E${i}` }); }
  assert.equal(j.list().length, Diag.MAX);
  assert.equal(j.unread, Diag.MAX);
  assert.equal(saved, j.list());
  j.add({ title: '' });                                 // sans titre : ignoré
  assert.equal(j.list()[0].title, `E${Diag.MAX + 19}`);
  j.clear();
  assert.equal(j.list().length, 0);
  assert.equal(j.unread, 0);
});

test('journal : reprend les entrées sauvegardées', () => {
  const j = Diag.createJournal({ load: () => [{ t: 1, title: 'vieux', read: true }, { t: 2, title: 'neuf' }] });
  assert.equal(j.list().length, 2);
  assert.equal(j.unread, 1);
  assert.equal(Diag.createJournal({ load: () => 'abîmé' }).list().length, 0);
});

test('refus de l\'ampli : message clair selon le code', () => {
  const e = Diag.rejectedEntry({ cmd: '3ATH', code: 'E04' }, 'Dialog Enhancement');
  assert.equal(e.sev, 'minor');
  assert.match(e.title, /Dialog Enhancement.*ne connaît pas/);
  assert.match(e.advice, /rapport/);
  assert.equal(e.raw, '3ATH → E04');
  assert.match(Diag.rejectedEntry({ cmd: 'XYZ', code: 'E02' }).title, /XYZ.*indisponible/);
  assert.match(Diag.rejectedEntry({ cmd: 'XYZ', code: 'E06' }).title, /hors limites/);
  assert.match(Diag.rejectedEntry({ cmd: 'XYZ', code: 'B00' }).title, /occupé/);
  assert.match(Diag.rejectedEntry({ cmd: 'XYZ', code: 'E09' }).title, /code E09/);
});

test('rapport : masquage, troncature de la trace, objet et nom de fichier', () => {
  const trace = Diag.createTrace(5, () => 0);
  for (let i = 0; i < 8; i++) trace.push(i % 2 ? 'rx' : 'tx', `L${i}`);
  assert.equal(trace.lines().length, 5);
  const r = Diag.buildReport({
    app: { version: '1.2.0' }, platform: 'android', host: '192.168.1.20', note: 'le réglage X ne fait rien',
    state: { model: 'VSX-930', firmware: '1.234', mac: '0009b0123456', params: { ATH: 1 }, names: { '01': 'CD' } },
    journal: [{ t: 0, sev: 'minor', title: 'T', raw: 'r' }], trace: trace.lines(), probe: true, now: () => Date.UTC(2026, 9, 18),
  });
  assert.equal(r.receiver.mac, '00:09:B0:xx:xx:xx');
  assert.equal(r.receiver.host, '192.168.1.x');
  assert.equal(r.trace.length, 5);
  assert.match(r.trace[0], /^00:00:00\.000 ← L3$/);
  assert.deepEqual(r.inputs, ['01']);
  assert.equal(r.probe, true);
  assert.equal(Diag.reportSubject(r), '[Pioneer Remote] Rapport VSX-930 fw 1.234 (v1.2.0)');
  assert.equal(Diag.reportFileName(r), 'pioneer-report-VSX-930-2026-10-18.json');
  assert.match(Diag.reportBody(r), /le réglage X ne fait rien/);
  assert.equal(Diag.maskMac(null), null);
  assert.equal(Diag.maskHost('ampli.local'), "nom d'hôte masqué");
  // Sans ampli connecté, le rapport reste valide
  const empty = Diag.buildReport({});
  assert.equal(empty.receiver.model, null);
  assert.match(Diag.reportSubject(empty), /modèle inconnu/);
});
