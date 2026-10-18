'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 25000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(30); }
  throw new Error('timeout: condition non atteinte');
}

test('mode démo : démarrage, état réaliste, mode d\'écoute -> canaux, arrêt propre', async () => {
  const { server, avr } = createServer({ presetsFile: path.join(os.tmpdir(), 'demo-presets.json'), configFile: path.join(os.tmpdir(), 'demo-config.json') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const syncs = [];
  const sse = await fetch(base + '/events');
  (async () => { const dec = new TextDecoder(); let buf = ''; for await (const c of sse.body) { buf += dec.decode(c); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = /^event: (\w+)\ndata: (.*)$/s.exec(buf.slice(0, i)); buf = buf.slice(i + 2); if (m && m[1] === 'sync') syncs.push(JSON.parse(m[2])); } } })().catch(() => {});
  try {
    assert.equal((await call('/api/demo', { on: true })).status, 200);
    await until(() => avr.status === 'connected' && avr.state.names['06'] && avr.state.tuner.names.A1);
    assert.equal((await fetch(base + '/api/state').then((r) => r.json())).demo, true);
    assert.equal(avr.state.names['25'], 'BD');
    assert.equal(avr.state.names['02'], 'TUNER');
    assert.equal(avr.state.names['00'], undefined, 'les entrées absentes de la démo ne sont pas listées');
    assert.equal(avr.state.tuner.names.A1, 'FRANCE I');

    // les canaux suivent le mode d'écoute
    const outs = () => avr.state.audio.output.map(Number).join('');
    await call('/api/cmd', { name: 'modeSet', arg: '0009' });
    await until(() => avr.state.mode === '0009' && outs().startsWith('101000000'));
    await call('/api/cmd', { name: 'modeSet', arg: '0010' });
    await until(() => outs().startsWith('111110001'));
    assert.equal(avr.state.audio.signal, '05', 'Dolby Digital sur BD');
    // l'afficheur réagit
    await call('/api/cmd', { name: 'volumeSet', arg: 100 });
    await until(() => /VOL/.test(avr.state.display));

    // progression de la synchronisation initiale
    assert.ok(syncs.length > 3 && syncs.some((s) => s.remaining === 0), 'événements sync jusqu\'à 0');

    assert.equal((await call('/api/demo', { on: false })).status, 200);
    await until(() => avr.status === 'disconnected');
    assert.equal((await fetch(base + '/api/state').then((r) => r.json())).demo, false);
  } finally { avr.disconnect(); server.close(); server.closeAllConnections?.(); }
});
