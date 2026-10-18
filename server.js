'use strict';
// Serveur local : HTTP + SSE autour du moteur (lib/engine.js). La logique des routes est dans le moteur,
// partagée avec l'application Android.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Avr } = require('./lib/avr');
const { discover, identify } = require('./lib/discovery');
const presets = require('./lib/presets');
const { createEngine } = require('./lib/engine');
const { startFake } = require('./fake-avr');

const CONFIG = process.env.PIONEER_CONFIG || path.join(__dirname, 'config.json');
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

function loadConfig(file = CONFIG) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function saveConfig(c, file = CONFIG) { try { fs.writeFileSync(file, JSON.stringify(c, null, 2)); } catch { /* lecture seule : tolérable */ } }

async function nodeDemo(profile) {
  const fake = startFake({ tcpPort: 0, httpPort: 0, ssdp: false, demo: true, profile });
  await fake.ready;
  return { host: '127.0.0.1', port: fake.tcpPort(), proto: fake.eiscp ? 'eiscp' : null, close: () => fake.close() };
}

function createServer({ avr = new Avr(), discoverFn = discover, identifyFn = identify, presetsFile = presets.FILE, configFile = CONFIG } = {}) {
  const engine = createEngine({
    avr, discoverFn, identifyFn, startDemo: nodeDemo,
    store: {
      getConfig: () => loadConfig(configFile), saveConfig: (c) => saveConfig(c, configFile),
      loadPresets: () => presets.load(presetsFile), savePresets: (l) => presets.save(l, presetsFile),
    },
  });
  const clients = new Set();
  engine.subscribe((event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  });

  const body = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: init\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const r = await engine.handle(req.method, url.pathname, req.method === 'GET' ? {} : await body(req));
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(r.body));
      }
      if (req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.join(PUBLIC, rel);
        if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404); res.end();
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    }
  });
  server.on('close', () => { engine.stopDemo(); });
  return { server, avr };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server, avr } = createServer();
  server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Pioneer remote : http://localhost:${port}`);
    const c = loadConfig();
    if (c.host) avr.connect(c.host, c.port, c.proto);
  });
}

module.exports = { createServer };
