'use strict';
// Robustesse face aux réponses d'erreur de l'ampli (B00, E02, E04) et encodages vérifiés sur les documents Pioneer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Avr } = require('../lib/avr');
const { createDevice } = require('../lib/fake-device');
const { CMD, parseLine } = require('../lib/protocol');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('délai dépassé'); await wait(20); } };

// Récepteur simulé en mémoire ; intercept(cmd) peut remplacer la réponse (null = comportement normal).
function make(profile, intercept = () => null) {
  const dev = createDevice({ demo: true, profile });
  const written = [];
  class Sock extends EventEmitter {
    constructor() { super(); setTimeout(() => this.emit('connect'), 5); }
    setEncoding() {} setTimeout() {}
    write(d) {
      const cmd = d.trim(); written.push(cmd);
      const lines = intercept(cmd) || dev.handle(cmd);
      setTimeout(() => this.emit('data', lines.map((l) => l + '\r\n').join('')), 5);
    }
    destroy() { setTimeout(() => this.emit('close'), 0); }
  }
  const avr = new Avr({ createSocket: () => new Sock() });
  avr.gapMs = 5;
  return { avr, dev, written };
}
const synced = (avr) => until(() => avr.status === 'connected' && avr.state.model && !avr.lowQueue.length && !avr.timer);

test('B00 / E02 : la commande est renvoyée, puis acceptée', async () => {
  let busy = 2;
  const { avr, dev, written } = make('fy11', (c) => (c === '19FN' && busy-- > 0 ? ['B00'] : null));
  avr.connect('x', 23); await synced(avr);
  const rejected = []; avr.on('rejected', (r) => rejected.push(r));
  avr.send('19FN');
  await until(() => dev.state.input === '19', 6000);
  assert.equal(written.filter((c) => c === '19FN').length, 3);
  assert.deepEqual(rejected, []);
  avr.disconnect();
});

test('E04 : refus signalé, sans nouvel essai ; une bascule (VU) n\'est jamais renvoyée', async () => {
  const { avr, written } = make('fy11', (c) => (c === '1ZZZ' || c === 'VU' ? ['E04'] : null));
  avr.connect('x', 23); await synced(avr);
  const rejected = []; avr.on('rejected', (r) => rejected.push(r));
  avr.send('1ZZZ'); await until(() => rejected.length === 1);
  assert.deepEqual(rejected[0], { cmd: '1ZZZ', code: 'E04' });
  avr.send('VU'); await until(() => rejected.length === 2);
  await wait(300);
  assert.equal(written.filter((c) => c === 'VU').length, 1);
  avr.disconnect();
});

test('volume absolu refusé (VSX-S510, VSX-528) : bascule en pas à pas jusqu\'à la cible', async () => {
  const { avr, dev, written } = make('fy11', (c) => (/^\d{3}VL$/.test(c) ? ['E04'] : null));
  avr.connect('x', 23); await synced(avr);
  const start = avr.state.volume;
  avr.send(CMD.volumeSet(start + 10));
  await until(() => avr.state.volume >= start + 10);
  assert.equal(avr.isStepOnly(), true);
  assert.ok(written.filter((c) => c === 'VU').length >= 5);
  avr.send(CMD.volumeSet(start)); await until(() => avr.state.volume <= start);
  assert.equal(written.filter((c) => /^\d{3}VL$/.test(c)).length, 1, 'plus de VL après le premier refus');
  assert.equal(dev.state.volume, avr.state.volume);
  avr.disconnect();
});

test('niveaux CLV : 50 = 0 dB et codes de canaux LH_/RH_ (documents FY14/FY16)', () => {
  assert.equal(CMD.clvSet('FL', 50), 'L__50CLV');
  assert.equal(CMD.clvSet('FHL', 52), 'LH_52CLV');
  assert.equal(CMD.clvSet('FWR', 26), 'RW_26CLV');
  assert.deepEqual(parseLine('CLVC__72').value, { ch: 'C', unit: 72 });
  assert.deepEqual(parseLine('CLVSW148').value, { ch: 'SW', unit: 48 });
});

test('vidéo : la démo accepte les codes documentés (résolution sur 2 chiffres)', async () => {
  const { avr } = make('fy11');
  avr.connect('x', 23); await synced(avr);
  await until(() => avr.state.video.C !== undefined);
  avr.send('06VTC'); await until(() => +avr.state.video.C === 6);
  avr.send('2VTD'); await until(() => +avr.state.video.D === 2);
  avr.disconnect();
});

test('HDZone (SC-LX79) : alimentation, volume (réponse XV), entrée, sourdine', async () => {
  const { avr } = make('modern');
  avr.connect('x', 23); await synced(avr);
  await until(() => avr.state.hdz.power === false);
  avr.send(CMD.hdzPowerOn); avr.send(CMD.hdzVolSet(40)); avr.send(CMD.hdzInputSet('19')); avr.send(CMD.hdzMuteOn);
  await until(() => avr.state.hdz.power && avr.state.hdz.volume === 40 && avr.state.hdz.input === '19' && avr.state.hdz.mute);
  assert.deepEqual(parseLine('HZV25'), { path: 'hdz.volume', value: 25 });
  avr.disconnect();
});

test('lecture : la famille de commande suit la source (réseau NW, iPod/USB IP, Bluetooth BT)', () => {
  const { mediaCommand } = require('../lib/protocol');
  assert.equal(mediaCommand('38', 'play'), '10NW');
  assert.equal(mediaCommand('53', 'next'), '13NW');
  assert.equal(mediaCommand('17', 'pause'), '01IP');
  assert.equal(mediaCommand('33', 'stop'), '12BT');
  assert.equal(mediaCommand('19', 'play'), null, 'pas de lecture sur une entrée HDMI');
});

test('modes d\'écoute : noms et liste propres au VSX-930, modes absents du SC-LX79', () => {
  const { MODE_RULES } = require('../lib/protocol');
  const rule = (m) => MODE_RULES.models.find((r) => new RegExp(r.re).test(m)) || {};
  assert.equal(rule('VSX-930').names['0040'], 'Dolby Surround');
  assert.ok(rule('VSX-930').only.includes('0100'));
  assert.ok(rule('SC-LX79').off.includes('0004'));
  assert.ok(rule('VSX-923').off.includes('0201'));
  assert.deepEqual(rule('VSX-1021'), {});
  assert.ok(MODE_RULES.twoCh.includes('0013') && MODE_RULES.multi.includes('0022'));
});

test('LFE ATT (ATM) : 1 chiffre en 2011, 2 chiffres (50 = coupé) à partir de FY14', () => {
  const { newState, applyEvent, paramCommand } = require('../lib/protocol');
  const s = newState();
  applyEvent(s, parseLine('ATM2'));
  assert.equal(s.params.ATM, 2); assert.equal(paramCommand('ATM', 5, s.wide), '5ATM');
  applyEvent(s, parseLine('ATM50'));
  assert.equal(s.params.ATM, 5, '50 = coupé'); assert.equal(paramCommand('ATM', 1, s.wide), '05ATM');
});

test('niveau d\'entrée (ILA), pas AM (SUQ) et sortie audio détaillée (AST long)', async () => {
  const { avr } = make('modern');
  avr.connect('x', 23); await synced(avr);
  await until(() => avr.state.inputLevels['25'] === 50 && avr.state.tuner.amStep === 9);
  avr.send(CMD.inputLevelSet(['25', 56])); await until(() => avr.state.inputLevels['25'] === 56);
  assert.equal(CMD.inputLevelSet(['25', 99]), '2574ILA', 'borné à +12 dB');
  assert.equal(avr.state.audio.outFreq, '04'); assert.equal(avr.state.audio.outBits, 24);
  avr.disconnect();
});

test('premières questions sans réponse (ampli qui sort de veille) : reposées en fin de lecture', async () => {
  let lost = 0;
  // Les 5 premières questions de base se perdent, comme constaté sur un VSX-921
  const { avr } = make('fy11', (c) => (['?P', '?V', '?M', '?F', '?S'].includes(c) && lost++ < 5 ? [] : null));
  avr.connect('x', 23);
  await until(() => avr.state.power === true && avr.state.volume != null && avr.state.input != null && avr.state.mode != null, 8000);
  avr.disconnect();
});

test('consigne perdue (ampli occupé) : renvoyée ; une consigne plus récente du même réglage n\'est pas écrasée', async () => {
  let drop = 1;
  const { avr, dev, written } = make('mid', (c) => (c === 'C__32CLV' && drop-- > 0 ? [] : null));
  avr.connect('x', 23); await synced(avr);
  avr.send('C__32CLV');
  await until(() => dev.state.levels?.[1] === 32 || avr.state.levels?.[1] === 32, 5000);
  assert.equal(written.filter((c) => c === 'C__32CLV').length, 2);
  // Deux valeurs successives, la première perdue : seule la dernière doit rester
  drop = 1;
  avr.send('C__32CLV'); avr.send('C__36CLV');
  await wait(1800);
  assert.equal(avr.state.levels[1], 36);
  assert.equal(written.filter((c) => c === 'C__32CLV').length, 3);
  avr.disconnect();
});

test('menu des réglages audio ouvert (APA) : les niveaux de canal attendent, le volume passe tout de suite', async () => {
  let apaAt = 0;
  const { avr, dev, written } = make('mid', (c) => {
    if (/^\dATH$/.test(c)) { apaAt = Date.now(); return ['APA', `ATH${c[0]}`]; }
    // Comme le VSX-921 : niveau ignoré tant que le menu reste affiché
    if (/CLV$/.test(c) && !c.startsWith('?') && Date.now() - apaAt < 10000) return [];
    return null;
  });
  avr.connect('x', 23); await synced(avr);
  avr.send('0ATH'); await until(() => avr.apaAt);
  avr.send('C__32CLV');
  const v = avr.state.volume; avr.send(`${String(v - 1).padStart(3, '0')}VL`);
  await until(() => avr.state.volume === v - 1, 1500);
  assert.equal(written.includes('C__32CLV'), false);
  await until(() => avr.state.levels?.[1] === 32, 14000);
  assert.equal(written.filter((c) => c === 'C__32CLV').length, 1);
  avr.disconnect();
});
