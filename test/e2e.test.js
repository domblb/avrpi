'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFake } = require('../fake-avr');
const { Avr } = require('../lib/avr');
const { ssdp, scan, probePort, identify } = require('../lib/discovery');
const { createServer } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(30); }
  throw new Error('timeout: condition non atteinte');
}

test('découverte SSDP trouve le faux récepteur', async () => {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdpPort: 0 });
  await fake.ready;
  try {
    const found = await ssdp({ timeout: 1500, target: { address: '127.0.0.1', port: fake.ssdpPort() } });
    assert.equal(found.length, 1);
    assert.equal(found[0].host, '127.0.0.1');
    assert.equal(found[0].model, 'VSX-1021');
  } finally { await fake.close(); }
});

test('balayage de ports trouve le port de contrôle', async () => {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false });
  await fake.ready;
  try {
    const port = fake.tcpPort();
    assert.equal(await probePort('127.0.0.1', port), true);
    assert.equal(await probePort('127.0.0.1', 1, 200), false);
    const events = [];
    const found = await scan({ ports: [port], prefixes: ['127.0.0'], timeout: 300, onProgress: (p) => events.push(p) });
    assert.ok(found.some((f) => f.host === '127.0.0.1' && f.port === port));
    assert.ok(events.some((e) => e.phase === 'scan' && e.done === 254), 'progression jusqu à 254/254');
    assert.ok(events.some((e) => e.phase === 'found'));
    assert.equal((await identify('127.0.0.1', [1, port], 1000)).port, port);
    assert.equal(await identify('127.0.0.1', [1], 300), null);
  } finally { await fake.close(); }
});

test('AVR : état initial, commandes, retours', async () => {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false });
  await fake.ready;
  const avr = new Avr();
  try {
    avr.connect('127.0.0.1', fake.tcpPort());
    await until(() => avr.state.treble !== null);
    assert.equal(avr.state.power, true);
    assert.equal(avr.state.volume, 101);
    assert.equal(avr.state.input, '25');
    assert.equal(avr.state.mode, '0010');
    assert.match(avr.state.display, /VSX-1021/);

    avr.send('VU');
    await until(() => avr.state.volume === 103);
    avr.send('050VL');
    await until(() => avr.state.volume === 50);
    avr.send('MO');
    await until(() => avr.state.mute === true);
    avr.send('04FN');
    await until(() => avr.state.input === '04');
    avr.send('APO');
    await until(() => avr.state.z2.power === true);
    avr.send('TFI');
    await until(() => avr.state.tuner.freq === 89.6);
    avr.send('PF');
    await until(() => avr.state.power === false);
  } finally { avr.disconnect(); await fake.close(); }
});

test('AVR : reconnexion après coupure', async () => {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false });
  await fake.ready;
  const port = fake.tcpPort();
  const avr = new Avr();
  avr.connect('127.0.0.1', port);
  await until(() => avr.status === 'connected');
  await fake.close();
  await until(() => avr.status !== 'connected');
  const fake2 = startFake({ tcpPort: port, httpPort: 0, ssdp: false });
  await fake2.ready;
  try { await until(() => avr.status === 'connected', 8000); } finally { avr.disconnect(); await fake2.close(); }
});

test('API HTTP : connexion, commande nommée, envoi brut, validation', async () => {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false });
  await fake.ready;
  const { server, avr } = createServer({ discoverFn: async () => [{ host: '127.0.0.1', port: fake.tcpPort(), source: 'test' }], identifyFn: async (host) => ({ host, port: fake.tcpPort() }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const d = await post('/api/discover', {});
    assert.equal(d.body.found.length, 1);
    // pas de persistance du config pendant le test
    const cfg = require('node:fs'); const path = require('node:path');
    const cfgPath = path.join(__dirname, '..', 'config.json');
    const before = cfg.existsSync(cfgPath) ? cfg.readFileSync(cfgPath) : null;
    assert.equal((await post('/api/connect', { host: '127.0.0.1' })).status, 200);
    if (before) cfg.writeFileSync(cfgPath, before); else cfg.rmSync(cfgPath, { force: true });
    await until(() => avr.status === 'connected' && avr.state.treble !== null);

    assert.equal((await post('/api/cmd', { name: 'volumeSet', arg: 60 })).status, 200);
    await until(() => avr.state.volume === 60);
    assert.equal((await post('/api/send', { cmd: '?V' })).status, 200);
    assert.equal((await post('/api/cmd', { name: 'nope' })).status, 400);
    assert.equal((await post('/api/send', { cmd: 'a\nb' })).status, 400);
    assert.equal((await post('/api/connect', { host: 'bad host;' })).status, 400);

    const st = await fetch(base + '/api/state').then((r) => r.json());
    assert.equal(st.state.volume, 60);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.equal((await fetch(base + '/../server.js')).status, 404);
  } finally { avr.disconnect(); server.close(); await fake.close(); }
});
