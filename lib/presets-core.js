'use strict';
// Préréglages : capture et conversion en commandes (pur, utilisable dans Node comme dans la WebView Android).
const { CMD, PARAMS, PRESET_GROUPS, CHANNELS, pad, paramCommand } = require('./protocol');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Champs capturables depuis l'état courant d'un récepteur.
const FIELDS = ['input', 'mode', 'spk', 'params', 'levels', 'eq', 'tone', 'bass', 'treble', 'volume', 'mute', 'z2', 'tunerPreset'];

function captureFromState(state, fields = FIELDS) {
  const data = {};
  for (const f of fields) {
    switch (f) {
      case 'input': if (state.input) data.input = state.input; break;
      case 'mode': if (state.mode) data.mode = state.mode; break;
      case 'spk': if (state.spk !== null) data.spk = state.spk; break;
      case 'params': {
        const p = {};
        for (const [k, def] of Object.entries(PARAMS)) {
          if (PRESET_GROUPS.includes(def.group) && !def.readOnly && !def.writeOnly && state.params[k] !== undefined) p[k] = state.params[k];
        }
        if (Object.keys(p).length) data.params = p;
        break;
      }
      case 'levels': if (state.levels) data.levels = [...state.levels]; break;
      case 'eq': if (state.eq) data.eq = [...state.eq]; break;
      case 'tone': if (state.tone !== null) data.tone = state.tone; break;
      case 'bass': if (state.bass !== null) data.bass = state.bass; break;
      case 'treble': if (state.treble !== null) data.treble = state.treble; break;
      case 'volume': if (state.volume !== null) data.volume = state.volume; break;
      case 'mute': if (state.mute !== null) data.mute = state.mute; break;
      case 'z2': if (state.z2.power !== null) data.z2 = { power: state.z2.power, input: state.z2.input, volume: state.z2.volume }; break;
      case 'tunerPreset': if (state.tuner.preset) data.tunerPreset = state.tuner.preset; break;
      default: break;
    }
  }
  return data;
}

// Transforme un preset en commandes brutes, dans un ordre sûr : le volume est appliqué en dernier, plafonné.
function buildCommands(data, { maxVolume = 161, levelsMode = 'ILV', currentLevels = null, wide = null } = {}) {
  const cmds = [];
  if (data.input) cmds.push(CMD.inputSet(data.input));
  if (data.tunerPreset) cmds.push(CMD.tunerPreset(data.tunerPreset));
  if (data.spk !== undefined) cmds.push(CMD.speakerSet(data.spk));
  if (data.mode) cmds.push(CMD.modeSet(data.mode));
  if (data.params) for (const [k, v] of Object.entries(data.params)) if (PARAMS[k]) cmds.push(paramCommand(k, v, wide));
  if (data.levels && data.levels.length >= 7) {
    const lv = data.levels.map((v) => clamp(v, 0, 100));
    if (levelsMode === 'CLV') {
      // modèles récents : une commande par canal qui diffère du niveau actuel
      lv.forEach((u, i) => { if (CHANNELS[i] && (!currentLevels || currentLevels[i] !== u)) cmds.push(CMD.clvSet(CHANNELS[i], clamp(u, 26, 74))); });
    } else cmds.push(CMD.levelsSet(lv));
  }
  if (data.eq && data.eq.length >= 4) cmds.push(CMD.eqSet(data.eq.map((v) => clamp(v, 0, 100))));
  if (data.tone !== undefined) cmds.push(data.tone ? CMD.toneOn : CMD.toneOff);
  if (data.bass !== undefined) cmds.push(CMD.bassSet(clamp(data.bass, -6, 6)));
  if (data.treble !== undefined) cmds.push(CMD.trebleSet(clamp(data.treble, -6, 6)));
  if (data.z2) {
    if (data.z2.input) cmds.push(CMD.z2InputSet(data.z2.input));
    if (data.z2.volume !== null && data.z2.volume !== undefined) cmds.push(CMD.z2VolSet(clamp(data.z2.volume, 0, Math.min(81, 81 - Math.ceil((161 - maxVolume) / 2)))));
    if (data.z2.power !== null && data.z2.power !== undefined) cmds.push(data.z2.power ? CMD.z2PowerOn : CMD.z2PowerOff);
  }
  if (data.volume !== undefined) cmds.push(CMD.volumeSet(clamp(data.volume, 0, maxVolume)));
  if (data.mute !== undefined) cmds.push(data.mute ? CMD.muteOn : CMD.muteOff);
  return cmds;
}

// Données d'un preset venant d'une sauvegarde : ne garde que les champs connus, au bon format (aucune commande arbitraire).
// Retourne null si quelque chose est mal formé.
function sanitizeData(d) {
  const isInt = (v) => Number.isInteger(v);
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (k === 'input' && /^\d{2}$/.test(v)) out.input = v;
    else if (k === 'mode' && /^\d{4}$/.test(v)) out.mode = v;
    else if (k === 'tunerPreset' && /^[A-G]\d{2}$/.test(v)) out.tunerPreset = v;
    else if (k === 'spk' && isInt(v) && v >= 0 && v <= 99) out.spk = v;
    else if ((k === 'bass' || k === 'treble') && isInt(v)) out[k] = v;
    else if ((k === 'volume') && isInt(v) && v >= 0) out.volume = v;
    else if ((k === 'tone' || k === 'mute') && typeof v === 'boolean') out[k] = v;
    else if ((k === 'levels' || k === 'eq') && Array.isArray(v) && v.length <= 32 && v.every(isInt)) out[k] = v;
    else if (k === 'params' && v && typeof v === 'object' && Object.entries(v).every(([c, x]) => PARAMS[c] && isInt(x) && x >= 0 && x < 1000)) out.params = v;
    else if (k === 'z2' && v && typeof v === 'object' && (v.input == null || /^\d{2}$/.test(v.input)) && (v.volume == null || isInt(v.volume)) && (v.power == null || typeof v.power === 'boolean')) out.z2 = v;
    else return null;
  }
  return out;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

module.exports = { FIELDS, captureFromState, buildCommands, sanitizeData, newId, pad };
