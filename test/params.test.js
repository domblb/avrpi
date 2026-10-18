'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PARAMS, LISTENING_MODES, CHANNELS, INPUT_CHANNELS, parseLine, paramCommand, paramFromCode, paramToCode, QUERIES } = require('../lib/protocol');
const presets = require('../lib/presets');
const { newState } = require('../lib/protocol');

test('paramètres : réponses réelles du VSX-1021 décodées', () => {
  for (const [line, code, val] of [['ATH1', 'ATH', 1], ['ATE06', 'ATE', 6], ['ATF000', 'ATF', 0], ['ATP03', 'ATP', 3], ['ATT09', 'ATT', 9], ['ATR50', 'ATR', 50], ['ATM0', 'ATM', 0], ['SDA0', 'SDA', 0]]) {
    assert.deepEqual(parseLine(line), { path: `params.${code}`, value: val }, line);
  }
  assert.deepEqual(parseLine('PWR2'), { path: 'power', value: false }, 'veille sur PWR2');
});

test('paramètres : écriture avec la bonne largeur', () => {
  assert.equal(paramCommand('ATH', 3), '3ATH');
  assert.equal(paramCommand('ATE', 6), '06ATE');
  assert.equal(paramCommand('ATF', 5), '005ATF');
  assert.equal(paramCommand('ATM', 1), '1ATM', 'LFE sur 1 chiffre (00ATM refusé par le VSX-1021)');
  assert.equal(paramCommand('ATR', 51), '51ATR');
});

test('paramètres : conversion valeur <-> code', () => {
  assert.equal(paramFromCode(PARAMS.ATR, 48), -2);
  assert.equal(paramToCode(PARAMS.ATR, -2), 48);
  assert.equal(paramFromCode(PARAMS.ATT, 9), 90);
  assert.equal(paramToCode(PARAMS.ATT, 30), 3);
  assert.ok(Math.abs(paramFromCode(PARAMS.ATS, 5) - 0.5) < 1e-9);
  assert.equal(paramToCode(PARAMS.ATS, 0.5), 5);
  assert.ok(Math.abs(paramFromCode(PARAMS.ATF, 10) - 1) < 1e-9);
});

test('toutes les définitions de paramètres sont cohérentes', () => {
  for (const [k, d] of Object.entries(PARAMS)) {
    assert.ok(['bool', 'enum', 'range'].includes(d.type), k);
    assert.ok(d.label && d.group, k);
    if (d.type === 'enum') for (const code of Object.keys(d.options)) assert.ok(String(code).length <= d.width, `${k} option ${code} plus large que ${d.width}`);
    if (d.type === 'range') { assert.ok(d.min < d.max, k); assert.ok(String(paramToCode(d, d.max)).length <= d.width, `${k} max dépasse ${d.width} chiffres`); }
  }
  for (const k of Object.keys(PARAMS)) if (k !== 'SPK' && !PARAMS[k].writeOnly) assert.ok(QUERIES.includes(`?${k}`), `?${k} interrogé au démarrage`);
});

test('modes d\'écoute : table complète, 0112 = EXTENDED STEREO', () => {
  assert.equal(LISTENING_MODES['0112'], 'EXTENDED STEREO');
  assert.equal(LISTENING_MODES['0010'], 'STANDARD');
  assert.equal(LISTENING_MODES['0009'], 'STEREO (direct)');
  assert.ok(Object.keys(LISTENING_MODES).every((k) => /^\d{4}$/.test(k)));
  assert.ok(Object.keys(LISTENING_MODES).length > 100);
});

test('canaux : caisson en 8 pour l\'entrée comme pour la sortie, SBL/SB/SBR dans l\'ordre', () => {
  assert.equal(CHANNELS[8], 'SW'); assert.equal(INPUT_CHANNELS[8], 'SW');
  assert.deepEqual(CHANNELS.slice(5, 8), ['SBL', 'SB', 'SBR']);
  assert.equal(INPUT_CHANNELS.length, 16);
});

test('presets : les paramètres sont écrits avec leur largeur', () => {
  const s = newState();
  s.params = { ATH: 3, ATF: 5, ATM: 1, ATE: 6, SSA: 0 };
  const data = presets.captureFromState(s, ['params']);
  assert.equal(data.params.SSA, undefined, 'SSA n\'est pas un paramètre de preset');
  const cmds = presets.buildCommands(data);
  assert.deepEqual(cmds.sort(), ['005ATF', '06ATE', '1ATM', '3ATH']);
});
