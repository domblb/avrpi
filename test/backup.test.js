'use strict';
// Sauvegarde / restauration : import des presets par le moteur, données filtrées (aucune commande arbitraire).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createEngine } = require('../lib/engine');
const { sanitizeData } = require('../lib/presets-core');
const { newState } = require('../lib/protocol');

function engineWith(list = []) {
  const avr = Object.assign(new EventEmitter(), { state: newState(), status: 'connected', send() {} });
  let presets = list, config = {};
  const store = { getConfig: () => config, saveConfig: (c) => { config = c; }, loadPresets: () => presets, savePresets: (l) => { presets = l; } };
  return { engine: createEngine({ avr, store, discoverFn: async () => [], identifyFn: async () => null }), presets: () => presets };
}

test('sanitizeData : garde un preset capturé, refuse les champs piégés', () => {
  const good = { input: '19', mode: '0101', spk: 1, params: { ATH: 2 }, levels: [50, 50], tone: true, bass: 0, volume: 121, z2: { power: true, input: '04', volume: 40 }, tunerPreset: 'A05' };
  assert.deepEqual(sanitizeData(good), good);
  assert.equal(sanitizeData({ input: '19\r999VL' }), null);
  assert.equal(sanitizeData({ mode: '01PF' }), null);
  assert.equal(sanitizeData({ params: { XYZ: 1 } }), null);
  assert.equal(sanitizeData({ inconnu: 1 }), null);
});

test('import : remplace les presets de même nom, ajoute les autres', async () => {
  const { engine, presets } = engineWith([{ id: 'a1', name: 'Film', data: { input: '01' } }]);
  const r = await engine.handle('POST', '/api/presets/import', { presets: [{ name: 'Film', data: { input: '19' } }, { name: 'Nuit', data: { volume: 80 } }] });
  assert.equal(r.status, 200);
  assert.equal(presets().length, 2);
  assert.deepEqual(presets()[0], { id: 'a1', name: 'Film', data: { input: '19' } });
  assert.equal(presets()[1].name, 'Nuit');
});

test('import : une sauvegarde mal formée est refusée en entier', async () => {
  const { engine, presets } = engineWith([]);
  const r = await engine.handle('POST', '/api/presets/import', { presets: [{ name: 'Ok', data: {} }, { name: 'Piège', data: { input: '19\rPF' } }] });
  assert.equal(r.status, 400);
  assert.equal(presets().length, 0);
});
