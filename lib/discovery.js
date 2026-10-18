'use strict';
const dgram = require('node:dgram');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const { CONTROL_PORTS, tag, isPioneer, deviceFromXml, createProbes, rankPrefixes } = require('./discovery-core');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

function fetchText(url, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; if (b.length > 100000) req.destroy(); });
      res.on('end', () => resolve(b));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

// Découverte SSDP. `target` permet de viser un faux récepteur en test.
function ssdp({ timeout = 3000, target = { address: SSDP_ADDR, port: SSDP_PORT } } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const pending = [];
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.on('message', (msg, rinfo) => {
      const m = /^location:\s*(.+)$/im.exec(msg.toString());
      if (!m || found.has(rinfo.address)) return;
      found.set(rinfo.address, null);
      pending.push(fetchText(m[1].trim()).then((xml) => {
        const dev = deviceFromXml(rinfo.address, xml);
        if (dev) found.set(rinfo.address, dev); else found.delete(rinfo.address);
      }));
    });
    sock.bind(0, () => {
      const msg = Buffer.from([
        'M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDR}:${SSDP_PORT}`, 'MAN: "ssdp:discover"',
        'MX: 2', 'ST: upnp:rootdevice', '', '',
      ].join('\r\n'));
      sock.send(msg, target.port, target.address);
      setTimeout(sock.send.bind(sock, msg, target.port, target.address), 500);
    });
    setTimeout(async () => {
      sock.close();
      await Promise.all(pending);
      resolve([...found.values()].filter(Boolean));
    }, timeout);
  });
}

function localSubnets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address.split('.').slice(0, 3).join('.'));
    }
  }
  return rankPrefixes(out);
}

const { probePort, askPower, identify, scan: scanCore } = createProbes((host, port) => net.createConnection({ host, port }));
const scan = (opts = {}) => scanCore({ prefixes: localSubnets(), ...opts });

async function discover(opts = {}) {
  const onProgress = (opts.onProgress) || (() => {});
  onProgress({ phase: 'ssdp', message: 'Recherche UPnP/SSDP (3 s)…' });
  const viaSsdp = await ssdp(opts.ssdp);
  if (viaSsdp.length) {
    viaSsdp.forEach((d) => onProgress({ phase: 'found', device: d, message: `Trouvé par SSDP : ${d.host}` }));
    return viaSsdp;
  }
  onProgress({ phase: 'ssdp', message: 'SSDP : aucune réponse. Balayage du réseau…' });
  return scan({ ...(opts.scan || {}), onProgress });
}

module.exports = { ssdp, scan, discover, probePort, askPower, identify, isPioneer, localSubnets, CONTROL_PORTS };
