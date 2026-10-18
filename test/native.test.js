'use strict';
// Moteur de l'APK sans réseau : Avr + moteur partagé sur le récepteur simulé en mémoire (mobile/native/socket.js).
const test = require('node:test');
const assert = require('node:assert');
const { Avr } = require('../lib/avr');
const { createEngine } = require('../lib/engine');
const { createSocketFactory, startDemo, DEMO_HOST } = require('../mobile/native/socket');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('délai dépassé'); await wait(50); } };

function make() {
  const mem = { cfg: {}, presets: [] };
  const avr = new Avr({ createSocket: createSocketFactory(null) });
  const engine = createEngine({
    avr, startDemo,
    discoverFn: async () => [], identifyFn: async () => null,
    store: { getConfig: () => mem.cfg, saveConfig: (c) => { mem.cfg = c; }, loadPresets: () => mem.presets, savePresets: (l) => { mem.presets = l; } },
  });
  avr.gapMs = 5;
  return { avr, engine, mem };
}

test('démo en mémoire : connexion, synchronisation, commande et préréglage', async () => {
  const { avr, engine, mem } = make();
  const r = await engine.handle('POST', '/api/demo', { on: true, profile: 'modern' });
  assert.equal(r.status, 200);
  await until(() => avr.state.model && avr.state.levelsMode === 'CLV' && Object.keys(avr.state.names).length > 5);
  assert.equal(avr.host, DEMO_HOST);
  assert.equal(avr.state.z3.power, false);   // zone 3 présente sur le profil récent

  assert.equal((await engine.handle('POST', '/api/set', { code: 'ATH', value: '3' })).status, 200);
  await until(() => avr.state.params.ATH === 3);

  const saved = await engine.handle('POST', '/api/presets', { name: 'Soirée' });
  assert.equal(saved.body.presets.length, 1);
  assert.equal(mem.presets.length, 1);
  assert.equal((await engine.handle('POST', `/api/presets/${mem.presets[0].id}/apply`)).status, 200);

  // la sécurité est identique à la version serveur
  assert.equal((await engine.handle('POST', '/api/send', { cmd: '185VL' })).status, 400);
  assert.equal((await engine.handle('POST', '/api/set', { code: 'SSQ', value: '1' })).status, 409);

  await engine.handle('POST', '/api/demo', { on: false });
  assert.equal(avr.status, 'disconnected');
});

test('profil ancien : niveaux ILV et égaliseur', async () => {
  const { avr, engine } = make();
  await engine.handle('POST', '/api/demo', { on: true, profile: 'fy11' });
  await until(() => avr.state.levels && avr.state.eq);
  assert.equal(avr.state.levelsMode, 'ILV');
  await engine.handle('POST', '/api/demo', { on: false });
});

test('profils de démo : chaque génération expose ses propres fonctions, changement de modèle à chaud', async () => {
  const { avr, engine } = make();
  const done = () => avr.state.model && avr.status === 'connected' && avr.lowQueue.length === 0 && !avr.timer;
  const run = async (profile) => {
    assert.equal((await engine.handle('POST', '/api/demo', { on: true, profile })).status, 200);
    await until(() => avr.state.model && done());
    await wait(100);
    return avr.state;
  };
  let s = await run('basic');
  assert.equal(s.model, 'VSX-521');
  assert.equal(s.z2.power, null); assert.equal(s.eq, null); assert.equal(s.video.B, undefined);
  assert.equal(s.levelsMode, 'ILV'); assert.equal(s.params.ATW, undefined);
  assert.equal(engine.snapshot().demoProfile, 'basic');

  s = await run('mid');   // pas d'arrêt explicite : le moteur remplace le récepteur simulé
  assert.equal(s.model, 'VSX-930');
  assert.equal(s.levelsMode, 'CLV'); assert.equal(s.z2.power, false); assert.equal(s.z3.power, null);
  assert.ok(s.params.ATW !== undefined); assert.equal(s.video.B, undefined);   // signal HDMI lisible, sans convertisseur vidéo
  assert.equal(engine.snapshot().demoProfile, 'mid');
  assert.deepEqual(Object.keys(engine.snapshot().demoProfiles), ['basic', 'fy11', 'mid', 'lx', 'modern']);
  await engine.handle('POST', '/api/demo', { on: false });
});

test('diagnostic complet : /api/refresh relit tout l\'état en lecture seule', async () => {
  const { avr, engine } = make();
  assert.equal((await engine.handle('POST', '/api/refresh')).status, 409);   // pas d'ampli : refusé
  await engine.handle('POST', '/api/demo', { on: true, profile: 'mid' });
  await until(() => avr.state.model && avr.status === 'connected' && avr.lowQueue.length === 0);
  const sent = [];
  avr.on('sent', (l) => sent.push(l));
  const syncs = [];
  avr.on('sync', (p) => syncs.push(p));
  assert.equal((await engine.handle('POST', '/api/refresh')).status, 200);
  assert.ok(Math.max(...syncs.map((p) => p.total)) > 50);
  await until(() => avr.lowQueue.length === 0 && !avr.timer);
  assert.ok(sent.length > 50);
  assert.deepEqual(sent.filter((c) => !c.startsWith('?')), []);   // aucune commande d'écriture
  await engine.handle('POST', '/api/demo', { on: false });
});
