'use strict';
// Préréglages côté serveur Node : logique pure dans presets-core.js, stockage dans un fichier JSON.
const fs = require('node:fs');
const path = require('node:path');
const core = require('./presets-core');

const FILE = process.env.PIONEER_PRESETS || path.join(__dirname, '..', 'presets.json');

function load(file = FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
function save(list, file = FILE) {
  try { fs.writeFileSync(file, JSON.stringify(list, null, 2)); } catch { /* lecture seule : tolérable */ }
}

module.exports = { ...core, load, save, FILE };
