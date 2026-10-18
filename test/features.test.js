'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startFake } = require('../fake-avr');
const { parseLine, applyEvent, newState, CMD } = require('../lib/protocol');
const presets = require('../lib/presets');
const { createServer } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(30); }
  throw new Error('timeout: condition non atteinte');
}

// Réponses relevées sur un vrai VSX-1021.
test('parseLine : réponses réelles du VSX-1021', () => {
  assert.equal(parseLine('FL0220204558542E53544552454F2020').value, 'EXT.STEREO');
  assert.deepEqual(parseLine('ILV5050505050505050505050505050505050').value, Array(17).fill(50));
  assert.deepEqual(parseLine('ATB0050505050505050505050').value, [0, ...Array(10).fill(50)]);
  assert.deepEqual(parseLine('SPK2'), { path: 'spk', value: 2 });
  assert.deepEqual(parseLine('PQ1'), { path: 'params.PQ', value: 1 });
  assert.deepEqual(parseLine('SSC040201'), { path: 'ssc.0402', value: 1 });
  assert.deepEqual(parseLine('RGB250BD'), { path: 'names.25', value: 'BD' });
  assert.deepEqual(parseLine('VTC00'), { path: 'video.C', value: '00' });
  assert.deepEqual(parseLine('BA06'), { path: 'bass', value: 0 });
  const a = parseLine('AST0002000000000000000000000111110001000000000').value;
  assert.equal(a.signal, '00'); assert.equal(a.freq, '02');
  assert.equal(a.input.length, 16); assert.equal(a.output.length, 18);
  assert.deepEqual(a.output.slice(0, 9), [true, true, true, true, true, false, false, false, true]);
});

test('parseLine : noms de mémoires tuner', () => {
  const s = newState();
  applyEvent(s, parseLine('TQA4"E       "'));
  assert.equal(s.tuner.names.A4, 'E');
});

test('commandes : écriture valeur avant code', () => {
  assert.equal(CMD.speakerSet(2), '2SPK');
  assert.equal(CMD.tunerPreset('A01'), 'A01PR');
  assert.equal(CMD.levelsSet(Array(17).fill(50)), '5050505050505050505050505050505050ILV');
  assert.equal(CMD.eqSet([0, ...Array(10).fill(50)]), '0050505050505050505050ATB');
  assert.equal(CMD.sscSet(4, 2, 1), '040201SSC');
  assert.equal(CMD.bassSet(0), '06BA'); assert.equal(CMD.bassSet(6), '00BA'); assert.equal(CMD.trebleSet(-6), '12TR');
});

test('presets : capture et commandes, volume plafonné et en dernier', () => {
  const s = newState();
  Object.assign(s, { input: '25', mode: '0010', spk: 2, volume: 150, mute: false, levels: Array(17).fill(52), eq: [0, ...Array(10).fill(50)], tone: false, bass: 2 });
  s.params = { PQ: 1, IS: 1, SPK: 2 };
  const data = presets.captureFromState(s);
  assert.equal(data.input, '25'); assert.equal(data.params.PQ, 1); assert.equal(data.params.SPK, undefined);
  const cmds = presets.buildCommands(data, { maxVolume: 120 });
  assert.equal(cmds[0], '25FN');
  assert.ok(cmds.includes('1PQ') && cmds.includes('1IS') && cmds.includes('2SPK') && cmds.includes('0010SR'));
  assert.ok(cmds.includes('04BA'), 'graves +2 dB -> BA04');
  const vi = cmds.indexOf('120VL');
  assert.ok(vi > -1, 'volume plafonné à 120');
  assert.ok(cmds.indexOf('1PQ') < vi && cmds.indexOf('5252525252525252525252525252525252ILV') < vi, 'volume après les autres réglages');
  assert.deepEqual(presets.captureFromState(s, ['volume']), { volume: 150 });
});

test('API : presets, set, levels, solo, plafond de volume', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pioneer-'));
  const presetsFile = path.join(dir, 'presets.json'), configFile = path.join(dir, 'config.json');
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false });
  await fake.ready;
  const { server, avr } = createServer({ presetsFile, configFile, identifyFn: async (host) => ({ host, port: fake.tcpPort() }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, b, method = 'POST') => fetch(base + p, { method, body: method === 'GET' ? undefined : JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    await call('/api/connect', { host: '127.0.0.1' });
    await until(() => avr.status === 'connected' && avr.state.eq !== null && avr.state.names['06'] && avr.state.tuner.names.A1);

    assert.equal(avr.state.spk, 2); assert.equal(avr.state.params.PQ, 1);
    assert.equal(avr.state.names['04'], 'INPUT04');
    assert.equal(avr.state.tuner.names.A1, 'FRANCE I');

    // set : paramètre simple, SSC, vidéo, invalide
    assert.equal((await call('/api/set', { code: 'IS', value: '2' })).status, 200);
    await until(() => avr.state.params.IS === 2);
    assert.equal((await call('/api/set', { code: 'SSC', value: '040205' })).status, 200);
    await until(() => avr.state.ssc['0402'] === 5);
    assert.equal((await call('/api/set', { code: 'PWN', value: '1' })).status, 400);
    assert.equal((await call('/api/set', { code: 'IS', value: '1;rm' })).status, 400);

    // niveaux et égaliseur
    const lv = Array(17).fill(50); lv[0] = 54;
    assert.equal((await call('/api/levels', { values: lv })).status, 200);
    await until(() => avr.state.levels[0] === 54);
    assert.equal((await call('/api/levels', { values: [1, 2] })).status, 400);
    const eq = [0, ...Array(10).fill(50)]; eq[3] = 60;
    await call('/api/eq', { values: eq }); await until(() => avr.state.eq[3] === 60);

    // écoute isolée puis restauration
    assert.equal((await call('/api/solo', { index: 2 })).status, 200);
    await until(() => avr.state.levels[0] === 26 && avr.state.levels[2] === 50);
    await call('/api/solo', { restore: true });
    await until(() => avr.state.levels[0] === 54);

    // plafond de volume
    assert.equal((await call('/api/config', { maxVolume: 120 })).status, 200);
    assert.equal((await call('/api/cmd', { name: 'volumeSet', arg: 130 })).status, 400);
    assert.equal((await call('/api/send', { cmd: '130VL' })).status, 400);
    assert.equal((await call('/api/cmd', { name: 'volumeSet', arg: 100 })).status, 200);
    await until(() => avr.state.volume === 100);
    assert.equal((await call('/api/config', { maxVolume: 999 })).status, 400);

    // presets : créer, lister, appliquer, renommer, supprimer
    const created = await call('/api/presets', { name: 'Film', fields: ['input', 'mode', 'spk', 'levels'] });
    assert.equal(created.status, 200);
    const p = created.body.presets[0];
    assert.equal(p.name, 'Film'); assert.equal(p.data.mode, '0010');
    assert.equal((await call('/api/presets', { name: '' })).status, 400);
    await call('/api/cmd', { name: 'inputSet', arg: '04' }); await until(() => avr.state.input === '04');
    await call('/api/cmd', { name: 'modeSet', arg: '0112' }); await until(() => avr.state.mode === '0112');
    const applied = await call(`/api/presets/${p.id}/apply`);
    assert.equal(applied.status, 200); assert.ok(applied.body.sent.includes('25FN'));
    await until(() => avr.state.input === '25' && avr.state.mode === '0010');
    assert.equal((await call('/api/presets/nope/apply')).status, 404);
    await call('/api/presets', { id: p.id, name: 'Cinéma' });
    assert.equal((await call('/api/presets', null, 'GET')).body[0].name, 'Cinéma');
    assert.equal((await call(`/api/presets/${p.id}`, null, 'DELETE')).body.presets.length, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(presetsFile, 'utf8')), []);

    // l'état initial expose les métadonnées utiles à l'interface
    const st = await call('/api/state', null, 'GET');
    assert.equal(st.body.maxVolume, 120); assert.ok(st.body.params.PQ); assert.equal(st.body.channels.length, 18);
  } finally { avr.disconnect(); server.close(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('interface : fichiers statiques servis, pas de sortie du dossier', async () => {
  const { server } = createServer({ presetsFile: path.join(os.tmpdir(), 'x-presets.json'), configFile: path.join(os.tmpdir(), 'x-config.json') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const f of ['/', '/core.js', '/view-home.js', '/view-speakers.js', '/view-sound.js', '/view-more.js', '/boot.js', '/style.css']) {
      assert.equal((await fetch(base + f)).status, 200, f);
    }
    assert.equal((await fetch(base + '/..%2Fserver.js')).status, 404);
    assert.equal((await fetch(base + '/config.json')).status, 404);
  } finally { server.close(); }
});
