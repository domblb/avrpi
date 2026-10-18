'use strict';
// Pioneer récents (eISCP, port 60128) : le pont lib/eiscp.js traduit le protocole classique ; testé sur le récepteur simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Avr } = require('../lib/avr');
const { createEngine } = require('../lib/engine');
const { frame, createDeframer, parseNri } = require('../lib/eiscp');
const { createEiscpDevice, NRI } = require('../lib/fake-eiscp');
const { CMD } = require('../lib/protocol');
const { createSocketFactory, startDemo } = require('../mobile/native/socket');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('délai dépassé'); await wait(20); } };

function make() {
  const dev = createEiscpDevice(), sent = [];
  const deframe = createDeframer();
  class Raw extends EventEmitter {
    constructor() { super(); this.io = dev.stream(); setTimeout(() => this.emit('connect'), 5); }
    setEncoding() {} setTimeout() {}
    write(d) { const s = typeof d === 'string' ? d : d.toString('latin1'); sent.push(...deframe(s)); const out = this.io(s); if (out) setTimeout(() => this.emit('data', out), 3); }
    destroy() { setTimeout(() => this.emit('close'), 0); }
  }
  const avr = new Avr({ createSocket: () => new Raw() });
  avr.gapMs = 5;
  return { avr, dev, sent };
}
const synced = (avr) => until(() => avr.status === 'connected' && avr.state.model && !avr.lowQueue.length && !avr.timer && avr.state.volume != null);

test('trames eISCP : en-tête de 16 octets, taille big-endian, terminateurs EOF/CR/LF', () => {
  const f = frame('!1PWRQSTN\r');
  assert.equal(f.slice(0, 4), 'ISCP');
  assert.equal(f.charCodeAt(7), 16); assert.equal(f.charCodeAt(11), 10); assert.equal(f.charCodeAt(12), 1);
  const d = createDeframer();
  const two = frame('!1PWR01\x1a\r\n') + frame('!1MVL2A\x1a\r\n');
  assert.deepEqual(d(two.slice(0, 20)), []);
  assert.deepEqual(d(two.slice(20)), ['PWR01', 'MVL2A']);
});

test('fiche NRI : modèle, nom, zones, entrées par zone, présélections', () => {
  const i = parseNri(NRI);
  assert.equal(i.model, 'VSX-LX303'); assert.equal(i.name, 'Salon LX303');
  assert.deepEqual(i.zones, { 1: true, 2: true, 3: false });
  assert.equal(i.selectors.find((s) => s.id === '12').zone, 1, 'TV : zone principale seulement');
  assert.deepEqual(i.presets.map((p) => p.name), ['France Inter', 'FIP', 'Nostalgie']);
});

test('pont eISCP : état, entrées de la fiche, volume, entrée, mode, tonalité, zone 2, tuner, lecture', async () => {
  const { avr, dev, sent } = make();
  avr.connect('192.0.2.1', 60128);
  await synced(avr);
  const s = avr.state;
  assert.equal(s.protocol, 'eiscp'); assert.equal(s.model, 'VSX-LX303'); assert.equal(s.friendlyName, 'Salon LX303');
  assert.equal(s.power, true); assert.equal(s.input, '25', 'BD/DVD (SLI 10) → entrée BD');
  assert.equal(s.volume, 0x6A - 3, 'MVL 0x6A → échelle Pioneer (0 dB = 161)');
  assert.equal(s.names['25'], 'BD/DVD'); assert.equal(s.names['05'], 'TV'); assert.equal(s.names['02'], 'TUNER');
  assert.equal(s.names['19'], undefined, 'entrée absente de la fiche');
  assert.equal(s.mode, '5128', 'LMD 80 (Dolby Surround)');
  assert.equal(s.z2.power, false); assert.equal(s.z3.power, null, 'pas de zone 3 sur ce modèle');
  assert.equal(s.levels, null); assert.deepEqual(s.params, {}, 'pas de réglages classiques : écrans masqués');
  assert.equal(s.tuner.names.A1, 'France Inter');

  avr.send(CMD.volumeSet(141)); await until(() => avr.state.volume === 141);
  assert.equal(dev.state.MVL, 144);
  avr.send(CMD.inputSet('26')); await until(() => avr.state.input === '26');
  assert.equal(dev.state.SLI, '2B');
  avr.send(CMD.modeSet('5001')); await until(() => avr.state.mode === '5001');
  avr.send(CMD.bassSet(3)); await until(() => avr.state.bass === 3);
  assert.equal(dev.state.B, 3);
  avr.send(CMD.z2PowerOn); avr.send(CMD.z2VolSet(41)); await until(() => avr.state.z2.power && avr.state.z2.volume === 41);
  avr.send('10NW'); avr.send('13NW'); await until(() => sent.includes('NTCTRUP'));
  avr.send(CMD.tunerBandFm); await until(() => avr.state.input === '02' && avr.state.tuner.band === 'FM');
  avr.send('B02PR'); await until(() => avr.state.tuner.preset === 'B02');
  assert.equal(dev.state.PRS, 11, 'B02 = présélection 11');
  avr.send(CMD.powerOff); await until(() => avr.state.power === false);
  avr.disconnect();
});

test('démo eISCP (APK et serveur) : profil VSX-LX303 et modes propres au protocole', async () => {
  const avr = new Avr({ createSocket: createSocketFactory(null) });
  const mem = { cfg: {}, presets: [] };
  const engine = createEngine({ avr, startDemo, discoverFn: async () => [], identifyFn: async () => null,
    store: { getConfig: () => mem.cfg, saveConfig: (c) => { mem.cfg = c; }, loadPresets: () => mem.presets, savePresets: (l) => { mem.presets = l; } } });
  assert.equal((await engine.handle('POST', '/api/demo', { on: true, profile: 'lx' })).status, 200);
  await until(() => avr.state.model === 'VSX-LX303' && avr.state.volume != null);
  assert.equal(avr.state.protocol, 'eiscp');
  assert.ok(engine.snapshot().modeRules.eiscp.includes('5128'));
  assert.equal(engine.snapshot().modes['5128'], 'Dolby Surround');
  await engine.handle('POST', '/api/demo', { on: false });
});
