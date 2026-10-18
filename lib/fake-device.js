'use strict';
// Modèle de récepteur Pioneer simulé (pur, sans réseau) : sert aux tests, au mode démo du navigateur et à celui de l'APK.
// Profils de démo, un par génération, pour voir comment l'appli s'adapte à ce que l'ampli sait faire :
//   basic  : entrée de gamme type VSX-521 (niveaux ILV, sans égaliseur, zone, vidéo)
//   fy11   : type VSX-1021 (ILV/ATB, zone 2 seule, convertisseur vidéo)
//   mid    : type VSX-930 (Dolby Atmos, niveaux par canal CLV, zone 2, sans convertisseur vidéo)
//   modern : type SC-LX79 (niveaux par canal CLV, zone 3, HDMI/installation, tous les réglages)
const { createEiscpDevice } = require('./fake-eiscp');
const { pad, LISTENING_MODES, PARAMS, INPUTS, CLV_CODES, CLV_NAMES, CHANNELS, paramToCode } = require('./protocol');

const hex = (t) => Array.from(String(t), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
const BASE_PARAMS = { PQ: 1, IS: 1, VSB: 0, VHT: 0, ATA: 0, MC: 4, ATE: 6, SSA: 0, ATH: 1, ATL: 1, ATM: 0, ATG: 0, ATJ: 0, ATK: 0, ATN: 0, ATO: 0, ATP: 3, ATQ: 0, ATR: 50, ATS: 0, ATT: 9, ATU: 1, ATF: 0, ATC: 1, ATD: 1, SDA: 0, SDB: 0, SAB: 0 };
// levels : ILV (bloc) ou CLV (par canal) ; params : liste de codes, ou 'all' ; install : calibration/HDMI lisibles
const DEMO_PROFILES = {
  basic: {
    label: 'Entrée de gamme (VSX-521, 2011)', model: 'VSX-521', fw: '0.410', levels: 'ILV', eq: false, zone2: false, zone3: false, z2tone: false, video: false, tone: true, install: false,
    params: ['ATA', 'ATC', 'ATD', 'ATH', 'ATL', 'ATM', 'IS', 'MC', 'SAB', 'SSA', 'ATP', 'ATR', 'ATS'],
    inputs: ['01', '02', '04', '05', '06', '15', '17', '19', '20', '25'],
  },
  fy11: {
    label: 'VSX-1021 (2011)', model: 'VSX-1021', fw: '0.512', levels: 'ILV', eq: true, zone2: true, zone3: false, z2tone: false, video: true, tone: true, install: false,
    params: Object.keys(BASE_PARAMS),
    inputs: ['01', '02', '04', '05', '06', '15', '17', '19', '20', '21', '22', '25', '26'],
  },
  mid: {
    label: 'Atmos milieu de gamme (VSX-930, 2016)', model: 'VSX-930', fw: '1.032', name: 'Salon VSX-930', levels: 'CLV', eq: false, zone2: true, zone3: false, z2tone: false, video: false, tone: true, install: false,
    params: [...Object.keys(BASE_PARAMS), 'ATW', 'ARA', 'ARB', 'VWD', 'HO', 'STU', 'SSE', 'STJ'],
    inputs: ['01', '02', '04', '05', '06', '10', '15', '17', '19', '20', '21', '22', '25', '26', '38', '41', '44', '45', '53'],
  },
  // Pioneer récent (conception Onkyo) : protocole eISCP, traduit par lib/eiscp.js
  lx: { label: 'Pioneer récent eISCP (VSX-LX303, 2018)', model: 'VSX-LX303', eiscp: true },
  modern: {
    label: 'Haut de gamme (SC-LX79, 2013)', model: 'SC-LX79', fw: '1.234', name: 'Salon Pioneer', levels: 'CLV', eq: false, zone2: true, zone3: true, hdzone: true, z2tone: true, video: true, tone: true, install: true,
    params: 'all',
    inputs: ['01', '02', '04', '05', '06', '10', '15', '17', '19', '20', '21', '22', '23', '24', '25', '26', '34', '35', '38', '41', '44', '45', '46', '48', '49', '53'],
  },
};
// Faux récepteur des tests (hors démo) : comportement historique, zone 3 comprise, sans modèle ni version.
const TEST_PROFILE = { ...DEMO_PROFILES.fy11, zone3: true };
const DEMO_STATIONS = ['FRANCE INTER', 'FRANCE INFO', 'FIP', 'FRANCE CULTURE', 'NRJ', 'RTL', 'CLASSIQUE', 'JAZZ RADIO', 'MOUV'];
const CH_INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c, i]));
const toHexFl = (t) => 'FL02' + hex(String(t).slice(0, 14).padEnd(14));
const KEYS = new Set(['CUP', 'CDN', 'CLE', 'CRI', 'CEN', 'CRT', 'HM', 'STS', 'ATA', 'VPA', 'HPA', 'CLC', 'KOF']);

// Valeur initiale d'un paramètre (premier code de la liste, ou borne basse d'une plage).
function defaultParam(def) {
  if (def.type === 'range') return paramToCode(def, def.min);
  return +Object.keys(def.options || { 0: '' })[0];
}

// Crée un récepteur simulé : handle(commande) retourne la liste des lignes de réponse.
function createDevice({ demo = false, profile = 'fy11' } = {}) {
  const P = demo ? DEMO_PROFILES[profile] || DEMO_PROFILES.fy11 : TEST_PROFILE;
  if (P.eiscp) return createEiscpDevice();
  const modern = demo && P.params === 'all';
  const clvLevels = demo && P.levels === 'CLV';
  const s = {
    power: true, volume: 101, mute: false, input: '25', mode: '0010',
    z2: { power: false, volume: 30, mute: false, input: '04', tone: false, bass: 6, treble: 6 },
    z3: { power: false, volume: 30, mute: false, input: '04' },
    hdz: { power: false, volume: 25, mute: false, input: '25' },
    freq: 8950, band: 'FM', preset: 'A01', tone: false, bass: 6, treble: 6, tac: '',
    spk: 2,
    params: { ...BASE_PARAMS },
    levels: Array(17).fill(50), eq: [0, ...Array(10).fill(50)], ssc: {},
    clv: Array(CHANNELS.length).fill(50), ila: {},
    // Vidéo (codes des documents Pioneer) : listes sur 1 chiffre, résolution sur 2, curseurs 50 = neutre
    vt: { B: '1', C: '00', D: '0', F: '0', G: '0', R: '0', S: '0', T: '0', ...Object.fromEntries('EHIJKLMNOPQ'.split('').map((c) => [c, '50'])) },
    names: {},
  };
  if (demo) { s.volume = 121; s.input = '25'; s.mode = '0010'; s.freq = 9600; s.preset = 'A01'; }
  if (modern) {
    for (const [k, def] of Object.entries(PARAMS)) if (k !== 'SPK' && !def.writeOnly && s.params[k] === undefined) s.params[k] = defaultParam(def);
    Object.assign(s.params, { SSQ: 2, SSP: 0, SST: 0, SSF: 0, STJ: 1, SSE: 1, HO: 0, HDO: 1, STQ: 1, STU: 0 });
  } else if (demo) {
    // Seuls les réglages du profil répondent : les autres restent masqués dans l'appli
    const all = s.params; s.params = {};
    for (const k of P.params) if (PARAMS[k] && !PARAMS[k].writeOnly) s.params[k] = all[k] ?? defaultParam(PARAMS[k]);
  }
  const model = P.model;
  const inputName = (id) => s.names[id] || INPUTS[id] || `INPUT ${id}`;
  const dbText = (v) => { const d = (v - 161) / 2; return `${d > 0 ? '+' : ''}${d.toFixed(1)}dB`; };
  const b = (v) => (v ? '0' : '1');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const demoInputs = P.inputs;
  const display = () => (demo ? toHexFl(s.power ? inputName(s.input) : '') : 'FL02' + hex((s.power ? 'VSX-1021 ' + s.input : '').padEnd(14)));
  const isSurroundSource = () => ['25', '04', '05', '06', '19', '20', '21', '22'].includes(s.input);

  // Canaux de sortie selon le mode (démo) : le plan des enceintes réagit au mode d'écoute.
  function astString() {
    if (!demo) return 'AST0002' + '0'.repeat(21) + '111110001000000000';
    const surround = isSurroundSource();
    const head = surround ? '0502' : '0003';
    const inflags = surround ? '1111100010000000' : '1010000000000000';
    const m = +s.mode;
    const on = new Set(['FL', 'FR']);
    if (![1, 9, 11, 7, 8].includes(m)) ['C', 'SL', 'SR', 'SW'].forEach((c) => on.add(c));
    if ([1, 11].includes(m)) on.add('SW');
    if ([31, 34, 92, 93, 94, 95, 96, 97, 10, 107].includes(m) && s.spk === 2) { on.add('FHL'); on.add('FHR'); }
    const out = Array(18).fill('0');
    on.forEach((c) => { if (CH_INDEX[c] !== undefined && CH_INDEX[c] < 18) out[CH_INDEX[c]] = '1'; });
    // Modèles récents : la réponse est plus longue (fréquence/bits de sortie, PQLS…)
    return `AST${head}${inflags}00000${out.join('')}${clvLevels ? '0424000000000' : ''}`;
  }
  const vstString = () => {
    if (!demo || (!clvLevels && !isSurroundSource())) return 'VST1' + '0'.repeat(30);
    return 'VST' + '4' + '09' + '2' + '3' + '1' + '0' + '09' + '2' + '3' + '1' + '0'.repeat(19);
  };

  const queries = {
    '?P': () => `PWR${b(s.power)}`, '?V': () => `VOL${pad(s.volume, 3)}`, '?M': () => `MUT${b(s.mute)}`,
    '?F': () => `FN${s.input}`, '?S': () => `SR${s.mode}`, '?FL': display,
    '?AP': () => `APR${b(s.z2.power)}`, '?ZV': () => `ZV${pad(s.z2.volume, 2)}`, '?ZS': () => `Z2F${s.z2.input}`,
    '?Z2M': () => `Z2MUT${b(s.z2.mute)}`,
    '?FR': () => (s.band === 'FM' ? `FRF${pad(s.freq, 5)}` : `FRA${pad(s.freq, 5)}`),
    '?PR': () => `PR${s.preset}`, '?SUQ': () => 'SUQ0',
    '?SPK': () => `SPK${s.spk}`, '?AST': astString, '?L': () => 'LM020d',
    '?TQ': () => (demo ? DEMO_STATIONS.map((n, i) => `TQA${i + 1}"${n.slice(0, 8).padEnd(8)}"`) : 'TQA1"FRANCE I"'),
    '?VST': vstString,
  };
  if (s.params.SSA !== undefined) queries['?SSA'] = () => `SSA${s.params.SSA}`;
  if (P.tone) Object.assign(queries, { '?TO': () => `TO${s.tone ? 1 : 0}`, '?BA': () => `BA${pad(s.bass, 2)}`, '?TR': () => `TR${pad(s.treble, 2)}` });
  if (!P.zone2) for (const q of ['?AP', '?ZV', '?ZS', '?Z2M']) delete queries[q];
  if (!clvLevels) queries['?ILV'] = () => `ILV${s.levels.map((v) => pad(v, 2)).join('')}`;
  if (P.eq) queries['?ATB'] = () => `ATB${s.eq.map((v) => pad(v, 2)).join('')}`;
  if (P.zone3) {
    Object.assign(queries, {
      '?BP': () => `BPR${b(s.z3.power)}`, '?YV': () => `YV${pad(s.z3.volume, 2)}`, '?ZT': () => `Z3F${s.z3.input}`, '?Z3M': () => `Z3MUT${b(s.z3.mute)}`,
    });
  }
  if (demo && P.hdzone) {
    Object.assign(queries, { '?ZEP': () => `ZEP${b(s.hdz.power)}`, '?HZV': () => `XV${pad(s.hdz.volume, 2)}`, '?ZEA': () => `ZEA${s.hdz.input}`, '?HZM': () => `HZMUT${b(s.hdz.mute)}` });
  }
  if (demo && P.z2tone) Object.assign(queries, { '?ZGA': () => `ZGA${s.z2.tone ? 1 : 0}`, '?ZGB': () => `ZGB${pad(s.z2.bass, 2)}`, '?ZGC': () => `ZGC${pad(s.z2.treble, 2)}` });
  if (demo && P.name) queries['?SSO'] = () => `SSO${P.name}`;
  if (demo && P.install) {
    Object.assign(queries, {
      '?SSG': () => ['SSG011', 'SSG021', 'SSG031', 'SSG040', 'SSG052', 'SSG061', 'SSG070'],
      '?SSR': () => ['FL', 'C', 'FR', 'SL', 'SR', 'SW'].map((c) => `SSR01${CLV_CODES[c]}${pad(50 + (c === 'SW' ? 2 : 0), 2)}`),
      '?SSS': () => ['FL', 'C', 'FR', 'SL', 'SR', 'SW'].map((c) => `SSS01${CLV_CODES[c]}${'1' + pad(c === 'C' ? 320 : c === 'SW' ? 280 : 350, 6)}`),
    });
  }
  if (clvLevels) for (const c of Object.values(CLV_CODES)) queries[`?${c}CLV`] = () => `CLV${c}${pad(s.clv[CH_INDEX[CLV_NAMES[c] || 'SW']] ?? 50, 2)}`;
  if (demo) {
    queries['?RGD'] = () => `RGD<${model}/SYXCN5>`;
    queries['?SSI'] = () => `SSI"${P.fw}"`;
    queries['?SVB'] = () => 'SVB00E036EF3788';
  }

  const keyEcho = (cmd) => (demo ? [toHexFl(`KEY ${cmd}`)] : ['R']);

  // Retourne la liste des lignes de réponse pour une commande.
  function handle(cmd) {
    if (queries[cmd]) { const r = queries[cmd](); return Array.isArray(r) ? r : [r]; }
    let m;
    if ((m = /^\?([A-Z]{2,3})$/.exec(cmd)) && PARAMS[m[1]] && m[1] !== 'SPK' && s.params[m[1]] !== undefined) return [`${m[1]}${pad(s.params[m[1]], PARAMS[m[1]].width)}`];
    if ((m = /^(\d{1,3})([A-Z]{2,3})$/.exec(cmd)) && PARAMS[m[2]] && m[2] !== 'SPK' && s.params[m[2]] !== undefined) {
      s.params[m[2]] = +m[1];
      return [`${m[2]}${pad(s.params[m[2]], PARAMS[m[2]].width)}`];
    }
    if (KEYS.has(cmd)) return keyEcho(cmd);
    const out = [];
    const push = (k) => out.push(queries[k]());
    const z3on = P.zone3, z2on = P.zone2;
    if (cmd === 'PO') { s.power = true; push('?P'); }
    else if (cmd === 'PF') { s.power = false; push('?P'); }
    else if (cmd === 'VU') { s.volume = clamp(s.volume + 2, 0, 185); push('?V'); if (demo) out.push(toHexFl(`VOL ${dbText(s.volume)}`)); }
    else if (cmd === 'VD') { s.volume = clamp(s.volume - 2, 0, 185); push('?V'); if (demo) out.push(toHexFl(`VOL ${dbText(s.volume)}`)); }
    else if ((m = /^(\d{3})VL$/.exec(cmd))) { s.volume = clamp(+m[1], 0, 185); push('?V'); if (demo) out.push(toHexFl(`VOL ${dbText(s.volume)}`)); }
    else if (cmd === 'MO') { s.mute = true; push('?M'); }
    else if (cmd === 'MF') { s.mute = false; push('?M'); }
    else if ((m = /^(\d{2})FN$/.exec(cmd))) { s.input = m[1]; push('?F'); if (demo) { out.push(toHexFl(inputName(s.input))); push('?AST'); } }
    else if ((m = /^(\d{4})SR$/.exec(cmd))) { s.mode = m[1]; push('?S'); out.push(toHexFl(LISTENING_MODES[m[1]] || 'MODE ' + m[1])); if (demo) push('?AST'); }
    else if (z2on && (cmd === 'APO' || cmd === 'APF')) { s.z2.power = cmd === 'APO'; push('?AP'); }
    else if (z2on && (cmd === 'ZU' || cmd === 'ZD')) { s.z2.volume = clamp(s.z2.volume + (cmd === 'ZU' ? 1 : -1), 0, 81); push('?ZV'); }
    else if (z2on && (m = /^(\d{2})ZV$/.exec(cmd))) { s.z2.volume = clamp(+m[1], 0, 81); push('?ZV'); }
    else if (z2on && (cmd === 'Z2MO' || cmd === 'Z2MF')) { s.z2.mute = cmd === 'Z2MO'; push('?Z2M'); }
    else if (z2on && (m = /^(\d{2})ZS$/.exec(cmd))) { s.z2.input = m[1]; push('?ZS'); }
    else if (z3on && (cmd === 'BPO' || cmd === 'BPF')) { s.z3.power = cmd === 'BPO'; push('?BP'); }
    else if (z3on && (cmd === 'YU' || cmd === 'YD')) { s.z3.volume = clamp(s.z3.volume + (cmd === 'YU' ? 1 : -1), 0, 81); push('?YV'); }
    else if (z3on && (m = /^(\d{2})YV$/.exec(cmd))) { s.z3.volume = clamp(+m[1], 0, 81); push('?YV'); }
    else if (z3on && (cmd === 'Z3MO' || cmd === 'Z3MF')) { s.z3.mute = cmd === 'Z3MO'; push('?Z3M'); }
    else if (z3on && (m = /^(\d{2})ZT$/.exec(cmd))) { s.z3.input = m[1]; push('?ZT'); }
    else if (demo && P.hdzone && (cmd === 'ZEO' || cmd === 'ZEF')) { s.hdz.power = cmd === 'ZEO'; push('?ZEP'); }
    else if (demo && P.hdzone && (cmd === 'HZU' || cmd === 'HZD')) { s.hdz.volume = clamp(s.hdz.volume + (cmd === 'HZU' ? 1 : -1), 0, 81); push('?HZV'); }
    else if (demo && P.hdzone && (m = /^(\d{2})HZV$/.exec(cmd))) { s.hdz.volume = clamp(+m[1], 0, 81); push('?HZV'); }
    else if (demo && P.hdzone && (cmd === 'HZMO' || cmd === 'HZMF')) { s.hdz.mute = cmd === 'HZMO'; push('?HZM'); }
    else if (demo && P.hdzone && (m = /^(\d{2})ZEA$/.exec(cmd))) { s.hdz.input = m[1]; push('?ZEA'); }
    else if (demo && P.z2tone && (cmd === '1ZGA' || cmd === '0ZGA')) { s.z2.tone = cmd === '1ZGA'; push('?ZGA'); }
    else if (demo && P.z2tone && (m = /^(\d{2})ZGB$/.exec(cmd))) { s.z2.bass = +m[1]; push('?ZGB'); }
    else if (demo && P.z2tone && (m = /^(\d{2})ZGC$/.exec(cmd))) { s.z2.treble = +m[1]; push('?ZGC'); }
    else if (cmd === 'TFI' || cmd === 'TFD') { s.freq += cmd === 'TFI' ? (s.band === 'FM' ? 10 : 9) : (s.band === 'FM' ? -10 : -9); push('?FR'); }
    else if (cmd === '00TN' || cmd === '01TN') { s.band = cmd === '00TN' ? 'FM' : 'AM'; s.freq = s.band === 'FM' ? 9600 : 693; push('?FR'); }
    else if (cmd === 'TAC') { s.tac = ''; }
    else if ((m = /^(\d)TP$/.exec(cmd))) {
      s.tac += m[1];
      const v = +s.tac;
      if (s.band === 'FM' && s.tac.length >= 4 && v >= 7600 && v <= 10800) s.freq = v;
      if (s.band === 'AM' && s.tac.length >= 3 && v >= 500 && v <= 1700) s.freq = v;
      push('?FR');
    }
    else if (cmd === 'TPI' || cmd === 'TPD') { const n = clamp(+s.preset.slice(1) + (cmd === 'TPI' ? 1 : -1), 1, 9); s.preset = 'A' + pad(n, 2); push('?PR'); }
    else if (P.tone && (cmd === '1TO' || cmd === '0TO')) { s.tone = cmd === '1TO'; push('?TO'); }
    else if (P.tone && (cmd === 'BI' || cmd === 'BD')) { s.bass = clamp(s.bass + (cmd === 'BD' ? 1 : -1), 0, 12); push('?BA'); }
    else if (P.tone && (cmd === 'TI' || cmd === 'TD')) { s.treble = clamp(s.treble + (cmd === 'TD' ? 1 : -1), 0, 12); push('?TR'); }
    else if ((m = /^(\d)SPK$/.exec(cmd))) { s.spk = +m[1]; push('?SPK'); if (demo) push('?AST'); }
    else if (!clvLevels && (m = /^((?:\d{2}){7,})ILV$/.exec(cmd))) { s.levels = m[1].match(/\d{2}/g).map(Number); push('?ILV'); }
    else if (P.eq && (m = /^((?:\d{2}){4,})ATB$/.exec(cmd))) { s.eq = m[1].match(/\d{2}/g).map(Number); push('?ATB'); }
    else if (clvLevels && (m = /^([A-Z_]{3})(\d{2})CLV$/.exec(cmd)) && CLV_NAMES[m[1]]) { s.clv[CH_INDEX[CLV_NAMES[m[1]]]] = +m[2]; out.push(queries[`?${m[1]}CLV`]()); }
    else if ((m = /^([A-G])(\d{2})PR$/.exec(cmd))) { s.preset = m[1] + m[2]; push('?PR'); }
    else if (P.tone && (m = /^(\d{2})BA$/.exec(cmd))) { s.bass = +m[1]; push('?BA'); }
    else if (P.tone && (m = /^(\d{2})TR$/.exec(cmd))) { s.treble = +m[1]; push('?TR'); }
    else if ((m = /^\?RGB(\d{2})$/.exec(cmd))) {
      if (!demo) out.push(`RGB${m[1]}0INPUT${m[1]}`);
      else if (demoInputs.includes(m[1])) out.push(`RGB${m[1]}${s.names[m[1]] ? 1 : 0}${inputName(m[1])}`);
      else out.push('E06');
    }
    else if ((m = /^1RGB(\d{2})(.{1,14})$/.exec(cmd))) { s.names[m[1]] = m[2]; out.push(`RGB${m[1]}1${m[2]}`); }
    else if ((m = /^0RGB(\d{2})$/.exec(cmd))) { delete s.names[m[1]]; out.push(`RGB${m[1]}0${INPUTS[m[1]] || ''}`); }
    else if ((m = /^\?SSC(\d{4})$/.exec(cmd))) out.push(`SSC${m[1]}${pad(s.ssc[m[1]] || 0, 2)}`);
    else if ((m = /^(\d{4})(\d{2})SSC$/.exec(cmd))) { s.ssc[m[1]] = +m[2]; out.push(`SSC${m[1]}${m[2]}`); }
    else if (demo && P.levels === 'CLV' && (m = /^\?ILA(\d{2})$/.exec(cmd))) out.push(`ILA${m[1]}${pad(s.ila[m[1]] ?? 50, 2)}`);
    else if (demo && P.levels === 'CLV' && (m = /^(\d{2})(\d{2})ILA$/.exec(cmd))) { s.ila[m[1]] = +m[2]; out.push(`ILA${m[1]}${m[2]}`); }
    else if ((m = /^(\d{2})(NW|IP|BT)$/.exec(cmd))) {
      // Lecture : la démo affiche l'action (sur un vrai ampli, la commande d'une autre famille de source est refusée)
      const fam = { 17: 'IP', 33: 'BT', 56: 'BT' }[+s.input] || (['26', '38', '41', '44', '45', '53', '62'].includes(s.input) ? 'NW' : null);
      if (fam !== m[2]) out.push('E02');
      else out.push(toHexFl({ NW: { 10: 'PLAY', 11: 'PAUSE', 12: 'PREV', 13: 'NEXT', 20: 'STOP' }, IP: { 0: 'PLAY', 1: 'PAUSE', 2: 'STOP', 3: 'PREV', 4: 'NEXT' }, BT: { 10: 'PLAY', 11: 'PAUSE', 12: 'STOP', 13: 'PREV', 14: 'NEXT' } }[fam][+m[1]] || `${fam} ${m[1]}`));
    }
    else if (P.video && /^\?VT[A-T]$/.test(cmd)) out.push(`VT${cmd[3]}${cmd[3] === 'A' ? '0' + '1'.repeat(17) : s.vt[cmd[3]]}`);
    else if (P.video && (m = /^(\d{1,2})VT([B-T])$/.exec(cmd)) && m[1].length === s.vt[m[2]].length) { s.vt[m[2]] = m[1]; out.push(`VT${m[2]}${m[1]}`); }
    else out.push('E04');
    return out;
  }

  return { state: s, model, handle };
}

// Liste des profils pour l'interface : { id: { label, model } }
const DEMO_LIST = Object.fromEntries(Object.entries(DEMO_PROFILES).map(([id, p]) => [id, { label: p.label, model: p.model }]));

module.exports = { createDevice, DEMO_PROFILES, DEMO_LIST };
