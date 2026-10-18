'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, applyEvent, newState, CMD, volumeDb, decodeDisplay } = require('../lib/protocol');

test('parseLine : alimentation, volume, mute (0 = actif)', () => {
  assert.deepEqual(parseLine('PWR0'), { path: 'power', value: true });
  assert.deepEqual(parseLine('PWR1'), { path: 'power', value: false });
  assert.deepEqual(parseLine('VOL121'), { path: 'volume', value: 121 });
  assert.deepEqual(parseLine('MUT0'), { path: 'mute', value: true });
});

test('parseLine : entrée, mode, zones', () => {
  assert.deepEqual(parseLine('FN25'), { path: 'input', value: '25' });
  assert.deepEqual(parseLine('SR0010'), { path: 'mode', value: '0010' });
  assert.deepEqual(parseLine('APR0'), { path: 'z2.power', value: true });
  assert.deepEqual(parseLine('Z3F04'), { path: 'z3.input', value: '04' });
  assert.deepEqual(parseLine('YV30'), { path: 'z3.volume', value: 30 });
});

test('parseLine : tuner, erreurs, inconnu', () => {
  assert.deepEqual(parseLine('FRF08950'), { path: 'tuner', value: { band: 'FM', freq: 89.5 } });
  assert.deepEqual(parseLine('FRA00630'), { path: 'tuner', value: { band: 'AM', freq: 630 } });
  assert.deepEqual(parseLine('E04'), { error: '04' });
  assert.equal(parseLine('???'), null);
  assert.equal(parseLine(''), null);
});

test('applyEvent met à jour les chemins imbriqués', () => {
  const s = newState();
  applyEvent(s, parseLine('ZV42'));
  applyEvent(s, parseLine('FRF10120'));
  assert.equal(s.z2.volume, 42);
  assert.equal(s.tuner.freq, 101.2);
});

test('commandes : formats', () => {
  assert.equal(CMD.volumeSet(5), '005VL');
  assert.equal(CMD.inputSet('04'), '04FN');
  assert.equal(CMD.modeSet('0010'), '0010SR');
  assert.equal(CMD.z2VolSet(7), '07ZV');
});

test('volume en dB : 161 = 0 dB', () => {
  assert.equal(volumeDb(161), 0);
  assert.equal(volumeDb(101), -30);
});

test('afficheur décodé', () => {
  const hex = '0200' + Buffer.from('HELLO').toString('hex').toUpperCase();
  assert.equal(decodeDisplay(hex), 'HELLO');
  assert.equal(parseLine('FL' + hex).value, 'HELLO');
});
