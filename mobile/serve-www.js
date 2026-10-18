'use strict';
// Sert www/ en statique pour tester le moteur local de l'APK dans un navigateur de bureau (démo uniquement).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer((q, r) => {
  const f = path.join(__dirname, 'www', q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!f.startsWith(path.join(__dirname, 'www')) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(3002, '127.0.0.1', () => console.log('http://127.0.0.1:3002'));
