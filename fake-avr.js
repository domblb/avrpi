'use strict';
// Faux récepteur Pioneer en réseau (TCP + SSDP) : sert aux tests et au mode démo du serveur Node.
// Le modèle du récepteur est dans lib/fake-device.js (aussi utilisé sans réseau par l'APK).
const net = require('node:net');
const dgram = require('node:dgram');
const http = require('node:http');
const { createDevice } = require('./lib/fake-device');

function startFake({ tcpPort = 8102, httpPort = 49152, ssdpPort = 1900, ssdp = true, demo = false, profile = 'fy11', log = () => {} } = {}) {
  const dev = createDevice({ demo, profile });
  const { state: s, model, handle } = dev;

  const socks = new Set();
  const tcp = net.createServer((sock) => {
    let buf = '';
    socks.add(sock); sock.on('close', () => socks.delete(sock));
    sock.setEncoding('latin1');
    sock.on('error', () => {});
    // Récepteur eISCP : trames binaires (lib/fake-eiscp.js)
    const io = dev.eiscp ? dev.stream() : null;
    sock.on('data', (d) => {
      if (io) { const out = io(d); if (out) sock.write(Buffer.from(out, 'latin1')); return; }
      buf += d;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const cmd = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!cmd) continue;
        log('<-', cmd);
        for (const line of handle(cmd)) sock.write(line + '\r\n');
      }
    });
  });

  const xml = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>` +
    `<friendlyName>Pioneer ${model} (fake)</friendlyName><manufacturer>Pioneer Corporation</manufacturer>` +
    `<modelName>${model}</modelName></device></root>`;
  const web = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/xml'); res.end(xml); });

  let udp = null;
  const ready = new Promise((resolve) => {
    let n = ssdp ? 3 : 2;
    const one = () => { if (--n === 0) resolve(); };
    tcp.listen(tcpPort, one);
    web.listen(httpPort, one);
    if (ssdp) {
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('error', (e) => log('ssdp:', e.message));
      udp.on('message', (msg, rinfo) => {
        if (!/M-SEARCH/i.test(msg.toString())) return;
        const reply = ['HTTP/1.1 200 OK', 'CACHE-CONTROL: max-age=1800', `LOCATION: http://127.0.0.1:${web.address().port}/desc.xml`,
          'ST: upnp:rootdevice', 'USN: uuid:fake-vsx-1021::upnp:rootdevice', '', ''].join('\r\n');
        udp.send(reply, rinfo.port, rinfo.address);
      });
      udp.bind(ssdpPort, () => {
        try { udp.addMembership('239.255.255.250'); } catch { /* pas de multicast : tolérable */ }
        one();
      });
    }
  });

  return {
    ready, state: s, model, eiscp: !!dev.eiscp,
    tcpPort: () => tcp.address().port, httpPort: () => web.address().port,
    ssdpPort: () => (udp ? udp.address().port : null),
    close: () => new Promise((r) => {
      try { udp && udp.close(); } catch { /* déjà fermé */ }
      web.closeAllConnections(); web.close();
      for (const k of socks) k.destroy();
      tcp.close(() => r());
    }),
  };
}

if (require.main === module) {
  const fake = startFake({ log: (...a) => console.log(...a) });
  fake.ready.then(() => console.log('Faux récepteur Pioneer : TCP 8102, SSDP 1900'));
}

module.exports = { startFake };
