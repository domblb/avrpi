'use strict';
// Compatibilité entre générations d'amplis : l'appli détecte ce que chaque modèle sait faire.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 40000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(30); }
  throw new Error('timeout: condition non atteinte');
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pioneer-models-'));
  const { server, avr } = createServer({ presetsFile: path.join(dir, 'p.json'), configFile: path.join(dir, 'c.json') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, b, method = 'POST') => fetch(base + p, { method, body: method === 'GET' ? undefined : JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try { await call('/api/config', { commandDelay: 30 }); await fn({ call, avr, base }); }
  finally { avr.disconnect(); server.close(); server.closeAllConnections?.(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const ready = (avr, last) => until(() => avr.status === 'connected' && avr.state.names[last] && avr.state.model);

test('ancien modèle (type VSX-1021) : ILV, égaliseur, zone 2 seule, pas d\'HDMI/installation', () => withServer(async ({ call, avr }) => {
  await call('/api/demo', { on: true, profile: 'fy11' });
  await ready(avr, '26');
  await until(() => avr.state.eq && avr.state.params.SAB !== undefined);
  assert.equal(avr.state.model, 'VSX-1021');
  assert.equal(avr.state.levelsMode, 'ILV');
  assert.equal(avr.state.levels.length, 17);
  assert.equal(avr.state.eq.length, 11);
  assert.equal(avr.state.z3.power, null, 'pas de zone 3');
  assert.equal(avr.state.z2.tone, null, 'pas de tonalité zone 2');
  assert.equal(avr.state.params.HO, undefined, 'pas de sortie HDMI sélectionnable');
  assert.equal(avr.state.params.SSQ, undefined, 'pas de réglages d\'installation');
  assert.equal(avr.state.names['00'], undefined, 'les entrées absentes ne sont pas listées');
  assert.equal(avr.state.videoInfo.terminal, 'HDMI', 'BD = source HDMI dans la démo');
}));

test('modèle récent (type SC-LX79) : niveaux CLV, zone 3, HDMI, installation, modèle et version', () => withServer(async ({ call, avr }) => {
  await call('/api/demo', { on: true, profile: 'modern' });
  await ready(avr, '53');
  await until(() => avr.state.levelsMode === 'CLV' && avr.state.z3.power !== null && avr.state.params.SSQ !== undefined && avr.state.z2.tone !== null);
  assert.equal(avr.state.model, 'SC-LX79');
  assert.equal(avr.state.firmware, '1.234');
  assert.equal(avr.state.friendlyName, 'Salon Pioneer');
  assert.equal(avr.state.levels.length, 18);
  assert.equal(avr.state.eq, null, 'pas d\'égaliseur ATB sur ce modèle');
  assert.equal(avr.state.names['53'], 'SPOTIFY');
  assert.equal(avr.state.names['34'], 'HDMI 7');
  assert.equal(avr.state.params.HO, 0);
  assert.equal(avr.state.audio.output.length, 18, 'sortie tronquée à 18 canaux malgré la réponse AST plus longue');
  assert.equal(avr.state.videoInfo.terminal, 'HDMI');
  assert.equal(avr.state.videoInfo.input.format, '1080/60p');
  assert.equal(avr.state.videoInfo.output.color, 'YCbCr 4:4:4');
  assert.ok(Object.keys(avr.state.speakerSetup).length >= 6, 'tailles des enceintes lues (SSG)');
  assert.equal(avr.state.mcacc['01'].FL, 0);
  assert.equal(avr.state.distances['01'].C, '1000320', 'distance métrique : 3,20 m');

  // niveaux par canal (CLV) : l'API reçoit un vecteur, l'ampli une commande par canal modifié
  const lv = [...avr.state.levels]; lv[1] = 56; lv[8] = 44;
  assert.equal((await call('/api/levels', { values: lv })).status, 200);
  await until(() => avr.state.levels[1] === 56 && avr.state.levels[8] === 44);
  assert.equal(avr.state.levels[0], 50, 'les autres canaux ne bougent pas');
  assert.equal((await call('/api/levels', { values: [1, 2, 3] })).status, 400);

  // écoute isolée puis restauration, en mode CLV
  assert.equal((await call('/api/solo', { index: 2 })).status, 200);
  await until(() => avr.state.levels[0] === 26 && avr.state.levels[2] === 50);
  await call('/api/solo', { restore: true });
  await until(() => avr.state.levels[1] === 56 && avr.state.levels[0] === 50);

  // réglages d'installation : confirmation obligatoire, lecture seule refusée
  assert.equal((await call('/api/set', { code: 'SSQ', value: '3' })).status, 409);
  assert.equal(avr.state.params.SSQ, 2, 'rien n\'a été écrit sans confirmation');
  assert.equal((await call('/api/set', { code: 'SSQ', value: '3', confirm: true })).status, 200);
  await until(() => avr.state.params.SSQ === 3);
  assert.equal((await call('/api/set', { code: 'SSU', value: '1', confirm: true })).status, 400);
  assert.equal((await call('/api/set', { code: 'HO', value: '1' })).status, 200, 'HDMI : pas de confirmation requise');
  await until(() => avr.state.params.HO === 1);
  assert.equal((await call('/api/set', { code: 'SAA', value: '2' })).status, 200, 'luminosité : écriture seule');

  // zone 3 et tonalité zone 2
  await call('/api/cmd', { name: 'z3PowerOn' }); await until(() => avr.state.z3.power === true);
  await call('/api/cmd', { name: 'z2BassSet', arg: 3 }); await until(() => avr.state.z2.bass === 3);

  // renommer une entrée, puis rétablir le nom d'origine
  assert.equal((await call('/api/rename', { id: '25', name: 'APPLE TV' })).status, 200);
  await until(() => avr.state.names['25'] === 'APPLE TV');
  assert.equal((await call('/api/rename', { id: '25', reset: true })).status, 200);
  await until(() => avr.state.names['25'] === 'BD');
  assert.equal((await call('/api/rename', { id: '2', name: 'x' })).status, 400);
  assert.equal((await call('/api/rename', { id: '25', name: 'é'.repeat(3) })).status, 400);

  // tuner : bande et fréquence directe
  assert.equal((await call('/api/tune', { band: 'FM', freq: 101.5 })).status, 200);
  await until(() => avr.state.tuner.band === 'FM' && avr.state.tuner.freq === 101.5);
  assert.equal((await call('/api/tune', { band: 'AM', freq: 1008 })).status, 200);
  await until(() => avr.state.tuner.band === 'AM' && avr.state.tuner.freq === 1008);
  assert.equal((await call('/api/tune', { band: 'FM', freq: 50 })).status, 400);

  // télécommande virtuelle
  assert.equal((await call('/api/key', { name: 'keyUp' })).status, 200);
  assert.equal((await call('/api/key', { name: 'powerOff' })).status, 400, 'seules les touches sont acceptées');

  // compatibilité : vitesse des commandes et échelle de volume
  assert.equal((await call('/api/config', { commandDelay: 120 })).status, 200);
  assert.equal((await call('/api/state', null, 'GET')).body.commandDelay, 120);
  assert.equal(avr.gapMs, 10, 'en démo le récepteur simulé reste rapide ; le délai servira au vrai ampli');
  assert.equal((await call('/api/config', { commandDelay: 5 })).status, 400);
  assert.equal((await call('/api/config', { volumeScale: { max: 131, zero: 111, step: 1 } })).status, 200);
  assert.deepEqual((await call('/api/state', null, 'GET')).body.volumeScale, { max: 131, zero: 111, step: 1 });
  assert.equal((await call('/api/config', { volumeScale: { max: 0, zero: 1, step: 1 } })).status, 400);
}));

test('presets multi-modèles : niveaux CLV rejoués canal par canal', () => withServer(async ({ call, avr }) => {
  await call('/api/demo', { on: true, profile: 'modern' });
  await ready(avr, '53');
  await until(() => avr.state.levelsMode === 'CLV' && avr.state.levels);
  const lv = [...avr.state.levels]; lv[1] = 58;
  await call('/api/levels', { values: lv }); await until(() => avr.state.levels[1] === 58);
  const created = await call('/api/presets', { name: 'Voix', fields: ['levels'] });
  const id = created.body.presets[0].id;
  assert.equal(created.body.presets[0].data.levels[1], 58);
  lv[1] = 50; await call('/api/levels', { values: lv }); await until(() => avr.state.levels[1] === 50);
  const applied = await call(`/api/presets/${id}/apply`);
  assert.deepEqual(applied.body.sent.filter((c) => c.endsWith('CLV')), ['C__58CLV'], 'seul le canal modifié est renvoyé');
  await until(() => avr.state.levels[1] === 58);
}));
