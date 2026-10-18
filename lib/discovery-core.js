'use strict';
// Découverte réseau portable : balayage TCP et vérification "?P". Les sockets, les sous-réseaux locaux et le SSDP sont injectés
// (Node : net / dgram / os ; APK Android : plugin natif).
// Les VSX de cette génération répondent sur telnet (23) ; d'autres modèles sur 8102.
const CONTROL_PORTS = [23, 8102];
const EISCP_PORT = 60128;

const tag = (xml, name) => (new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml) || [])[1] || '';
const isPioneer = (xml) => /pioneer|onkyo/i.test(tag(xml, 'manufacturer')) || /^VSX-/i.test(tag(xml, 'modelName'));
// Fiche trouvée par SSDP à partir du XML de description UPnP (null si ce n'est pas un Pioneer).
const deviceFromXml = (host, xml) => (xml && isPioneer(xml)
  ? { host, port: null, source: 'ssdp', name: tag(xml, 'friendlyName') || tag(xml, 'modelName'), model: tag(xml, 'modelName') }
  : null);

// createSocket(host, port) -> socket de même interface que net.Socket
function createProbes(createSocket) {
  function probePort(host, port, timeout = 600) {
    return new Promise((resolve) => {
      const s = createSocket(host, port);
      const done = (ok) => { s.destroy(); resolve(ok); };
      s.setTimeout(timeout);
      s.on('connect', () => done(true));
      s.on('timeout', () => done(false));
      s.on('error', () => done(false));
    });
  }

  // Vérifie qu'un récepteur Pioneer répond bien : "?P" doit renvoyer "PWR0" ou "PWR1".
  function askPower(host, port, timeout = 1500) {
    return new Promise((resolve) => {
      const s = createSocket(host, port);
      let buf = '';
      const done = (ok) => { clearTimeout(t); s.destroy(); resolve(ok); };
      const t = setTimeout(() => done(false), timeout);
      s.setEncoding('latin1');
      s.on('connect', () => setTimeout(() => s.write('?P\r'), 150));
      s.on('data', (d) => { buf += d; if (/PWR[01]/.test(buf)) done(true); });
      s.on('error', () => done(false));
    });
  }

  // Trouve le port de contrôle d'un hôte (null si aucun ne répond comme un Pioneer).
  // Les Pioneer d'après 2016 environ (conception Onkyo) parlent eISCP sur le port 60128 : signalés comme tels.
  async function identify(host, ports = CONTROL_PORTS, timeout = 1500) {
    for (const port of ports) {
      if (await askPower(host, port, timeout)) return { host, port, source: 'verified', name: host };
    }
    if (await probePort(host, EISCP_PORT, 800)) return { host, port: EISCP_PORT, eiscp: true, name: host };
    return null;
  }

  // Balayage des /24 locaux : TCP ouvert sur un port de contrôle, puis vérification par "?P".
  async function scan({ ports = CONTROL_PORTS, prefixes, timeout = 600, concurrency = 128, onProgress = () => {} } = {}) {
    const hosts = prefixes.flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
    const found = [];
    let idx = 0, done = 0;
    const worker = async () => {
      while (idx < hosts.length) {
        const h = hosts[idx++];
        const open = (await Promise.all([...ports, EISCP_PORT].map((p) => probePort(h, p, timeout)))).some(Boolean);
        if (open) {
          const dev = await identify(h, ports);
          if (dev) { found.push(dev); onProgress({ phase: 'found', device: dev, message: `Trouvé : ${dev.host}:${dev.port}` }); }
        }
        done++;
        if (done % 16 === 0 || done === hosts.length) {
          onProgress({ phase: 'scan', done, total: hosts.length, subnet: h.split('.').slice(0, 3).join('.') + '.x',
            message: `Balayage ${h.split('.').slice(0, 3).join('.')}.x — ${done}/${hosts.length} adresses` });
        }
      }
    };
    onProgress({ phase: 'scan', done: 0, total: hosts.length, message: `Balayage de ${prefixes.length} réseau(x) : ${prefixes.map((p) => p + '.x').join(', ')}` });
    await Promise.all(Array.from({ length: concurrency }, worker));
    return found;
  }

  return { probePort, askPower, identify, scan };
}

// Les réseaux privés usuels d'abord, le lien-local (169.254) en dernier.
function rankPrefixes(list) {
  const rank = (p) => (p.startsWith('169.254.') ? 2 : p.startsWith('192.168.') ? 0 : 1);
  return [...new Set(list)].sort((a, b) => rank(a) - rank(b));
}

module.exports = { CONTROL_PORTS, tag, isPioneer, deviceFromXml, createProbes, rankPrefixes };
