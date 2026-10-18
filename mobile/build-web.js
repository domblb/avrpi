'use strict';
// Prépare www/ : copie l'interface (../public) et empaquette le moteur local (native/entry.js) dans native.js.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname, pub = path.join(root, '..', 'public'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(pub)) fs.copyFileSync(path.join(pub, f), path.join(out, f));

esbuild.buildSync({
  entryPoints: [path.join(root, 'native', 'entry.js')], outfile: path.join(out, 'native.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true,
  alias: { 'node:events': path.join(root, 'native', 'stubs', 'events.js'), 'node:net': path.join(root, 'native', 'stubs', 'net.js') },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// native.js doit s'exécuter avant core.js (il remplace fetch et EventSource)
// Pas de viewport-fit=cover dans l'APK : Android (15+) dessine sinon l'appli derrière la barre d'état et la barre de navigation ;
// sans lui, la WebView est placée entre les deux barres.
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  .replace(', viewport-fit=cover', '')
  .replace('<script src="core.js"></script>', '<script src="native.js"></script>\n<script src="core.js"></script>');
if (!html.includes('native.js')) throw new Error('index.html : balise core.js introuvable');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('www/ prêt :', fs.readdirSync(out).join(', '));
