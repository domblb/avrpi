'use strict';
// Sockets de l'application : TCP natif (plugin Android PioneerNet) ou récepteur simulé en mémoire (mode démo).
// Les deux ont l'interface de net.Socket utilisée par lib/avr.js et lib/discovery-core.js.
const { EventEmitter } = require('node:events');
const { createDevice } = require('../../lib/fake-device');

const DEMO_HOST = 'demo.local';

class NativeSocket extends EventEmitter {
  constructor(plugin, host, port) {
    super();
    this.plugin = plugin; this.id = null; this.closed = false; this.timer = null;
    plugin.connect({ host, port, timeout: 5000 }).then(({ id }) => {
      this.id = id;
      NativeSocket.all.set(id, this);
      if (this.closed) return this._release();
      this.emit('connect');
    }).catch((e) => { this.emit('error', new Error(e?.message || 'connexion impossible')); this._end(); });
  }
  setEncoding() {}
  setTimeout(ms) {
    clearTimeout(this.timer); this.timer = null;
    if (ms > 0) this.timer = setTimeout(() => this.emit('timeout'), ms);
  }
  write(data) { if (this.id !== null && !this.closed) this.plugin.write({ id: this.id, data }).catch(() => this.destroy()); }
  destroy() { this._end(); }
  _release() { if (this.id !== null) { NativeSocket.all.delete(this.id); this.plugin.close({ id: this.id }).catch(() => {}); } }
  _end() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    this._release();
    setTimeout(() => this.emit('close'), 0);
  }
}
NativeSocket.all = new Map();

// Récepteur simulé : même interface, sans réseau.
let demoDevice = null;
class DemoSocket extends EventEmitter {
  constructor() {
    super(); this.closed = false; this.buf = '';
    setTimeout(() => !this.closed && this.emit('connect'), 5);
  }
  setEncoding() {}
  setTimeout() {}
  write(data) {
    if (demoDevice?.eiscp) {   // récepteur eISCP simulé : trames binaires
      const out = (this.io ||= demoDevice.stream())(data);
      if (out) setTimeout(() => { if (!this.closed) this.emit('data', out); }, 10);
      return;
    }
    this.buf += data;
    let i;
    while ((i = this.buf.search(/[\r\n]/)) >= 0) {
      const cmd = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!cmd || !demoDevice) continue;
      const lines = demoDevice.handle(cmd);
      setTimeout(() => { if (!this.closed) this.emit('data', lines.map((l) => l + '\r\n').join('')); }, 10);
    }
  }
  destroy() { if (this.closed) return; this.closed = true; setTimeout(() => this.emit('close'), 0); }
}

// Sans plugin (navigateur de bureau) seul le mode démo fonctionne.
class UnavailableSocket extends EventEmitter {
  constructor() { super(); setTimeout(() => { this.emit('error', new Error('réseau natif indisponible')); this.emit('close'); }, 0); }
  setEncoding() {}
  setTimeout() {}
  write() {}
  destroy() {}
}

function createSocketFactory(plugin) {
  if (plugin) {
    plugin.addListener('tcpData', ({ id, data }) => NativeSocket.all.get(id)?.emit('data', data));
    plugin.addListener('tcpClose', ({ id, error }) => {
      const s = NativeSocket.all.get(id);
      if (!s) return;
      if (error) s.emit('error', new Error(error));
      s._end();
    });
  }
  return (host, port) => {
    if (host === DEMO_HOST) return new DemoSocket();
    return plugin ? new NativeSocket(plugin, host, port) : new UnavailableSocket();
  };
}

function startDemo(profile) {
  demoDevice = createDevice({ demo: true, profile });
  return Promise.resolve({ host: DEMO_HOST, port: 0, proto: demoDevice.eiscp ? 'eiscp' : null, close: () => { demoDevice = null; } });
}

module.exports = { createSocketFactory, startDemo, DEMO_HOST };
