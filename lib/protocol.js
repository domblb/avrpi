'use strict';
// Protocole ASCII Pioneer (TCP 23 ou 8102, commandes terminées par CR, réponses par CRLF).
// Sources : réponses relevées sur un VSX-1021, APK iControlAV2, et la table de la bibliothèque aiopioneer
// (listening modes, paramètres DSP, disposition de ?AST).

const pad = (n, w) => String(Math.round(n)).padStart(w, '0');

const INPUTS = {
  '00': 'PHONO', '01': 'CD', '02': 'TUNER', '03': 'CD-R/TAPE', '04': 'DVD', '05': 'TV/SAT', '06': 'SAT/CBL',
  '10': 'VIDEO 1', '12': 'MULTI CH IN', '13': 'USB-DAC', '14': 'VIDEO 2', '15': 'DVR/BDR', '17': 'iPod/USB',
  '18': 'XM RADIO', '19': 'HDMI 1', '20': 'HDMI 2', '21': 'HDMI 3', '22': 'HDMI 4', '23': 'HDMI 5', '24': 'HDMI 6',
  '25': 'BD', '26': 'NETWORK', '27': 'SIRIUS', '31': 'HDMI (cyc)', '33': 'ADAPTER PORT', '34': 'HDMI 7', '35': 'HDMI 8',
  '38': 'INTERNET RADIO', '40': 'SIRIUS', '41': 'PANDORA', '44': 'MEDIA SERVER', '45': 'FAVORITES', '46': 'AirPlay',
  '47': 'DMR', '48': 'MHL', '49': 'GAME', '53': 'SPOTIFY', '29': 'AUX', '54': 'AM', '55': 'DAB', '56': 'BT AUDIO', '62': 'Qobuz',
};
// Commandes de lecture selon la famille de la source (documents Pioneer 2011/FY14, aiopioneer) : "<code>NW", "<code>IP", "<code>BT".
const MEDIA_CODES = {
  NW: { play: 10, pause: 11, prev: 12, next: 13, rew: 14, ff: 15, stop: 20, repeat: 34, shuffle: 35 },
  IP: { play: 0, pause: 1, stop: 2, prev: 3, next: 4, rew: 5, ff: 6, repeat: 7, shuffle: 8 },
  BT: { play: 10, pause: 11, stop: 12, prev: 13, next: 14, rew: 15, ff: 16, repeat: 17, shuffle: 18 },
};
const MEDIA_SOURCES = { 17: 'IP', 26: 'NW', 38: 'NW', 41: 'NW', 44: 'NW', 45: 'NW', 53: 'NW', 62: 'NW', 33: 'BT', 56: 'BT' };
const mediaCommand = (input, action) => {
  const kind = MEDIA_SOURCES[+input], code = kind && MEDIA_CODES[kind][action];
  return code === undefined ? null : `${String(code).padStart(2, '0')}${kind}`;
};
// Identifiants interrogés au démarrage (l'ampli répond E06 pour ceux qu'il n'a pas).
const INPUT_IDS = Array.from({ length: 63 }, (_, i) => String(i).padStart(2, '0'));

// Modèles récents : niveau par canal via CLV (code canal sur 3 caractères, valeur 26 à 74, 50 = 0 dB, 0,5 dB par pas ;
// documents Pioneer FY14/FY16). Hauteur et largeur s'écrivent LH_/RH_/LW_/RW_.
const CLV_CODES = {
  FL: 'L__', C: 'C__', FR: 'R__', SL: 'SL_', SR: 'SR_', SBL: 'SBL', SBR: 'SBR', SW: 'SW_',
  FHL: 'LH_', FHR: 'RH_', FWL: 'LW_', FWR: 'RW_', TML: 'TML', TMR: 'TMR', TRL: 'TRL', TRR: 'TRR', SW2: 'SW2',
};
const CLV_NAMES = Object.fromEntries(Object.entries(CLV_CODES).map(([k, v]) => [v, k]));
CLV_NAMES.LFE = 'SW'; CLV_NAMES.SW1 = 'SW';

// Modes d'écoute (code SR). Table aiopioneer ; 0112 = EXTENDED STEREO confirmé sur le VSX-1021.
const MODE_TABLE = {
  1: 'STEREO', 3: 'Front Stage Surround Advance', 4: 'Front Stage Surround Advance Wide', 5: 'AUTO SURR/STREAM DIRECT',
  6: 'AUTO SURROUND', 7: 'DIRECT', 8: 'PURE DIRECT', 9: 'STEREO (direct)', 10: 'STANDARD', 11: '2ch', 12: 'PRO LOGIC',
  13: 'PRO LOGIC2 MOVIE', 14: 'PRO LOGIC2 MUSIC', 15: 'PRO LOGIC2 GAME', 16: 'Neo:6 CINEMA', 17: 'Neo:6 MUSIC',
  18: 'PRO LOGIC2x MOVIE', 19: 'PRO LOGIC2x MUSIC', 20: 'PRO LOGIC2x GAME', 21: 'Multi ch', 22: 'DOLBY EX',
  23: 'PRO LOGIC2x MOVIE (2)', 24: 'PRO LOGIC2x MUSIC (2)', 25: 'DTS-ES Neo', 26: 'DTS-ES matrix', 27: 'DTS-ES discrete',
  28: 'XM HD SURROUND', 29: 'NEURAL SURROUND', 30: 'DTS-ES 8ch discrete', 31: 'PRO LOGIC2z HEIGHT',
  32: 'WIDE SURROUND MOVIE', 33: 'WIDE SURROUND MUSIC', 34: 'PRO LOGIC2z HEIGHT (2)', 35: 'WIDE SURROUND MOVIE (2)',
  36: 'WIDE SURROUND MUSIC (2)', 37: 'Neo:X CINEMA', 38: 'Neo:X MUSIC', 39: 'Neo:X GAME',
  40: 'NEURAL SURROUND+Neo:X CINEMA', 41: 'NEURAL SURROUND+Neo:X MUSIC', 42: 'NEURAL SURROUND+Neo:X GAME',
  43: 'Neo:X CINEMA (2)', 44: 'Neo:X MUSIC (2)', 45: 'Neo:X GAME (2)',
  51: 'PROLOGIC + THX CINEMA', 52: 'PL2 MOVIE + THX CINEMA', 53: 'Neo:6 CINEMA + THX CINEMA',
  54: 'PL2x MOVIE + THX CINEMA', 55: 'THX SELECT2 GAMES', 56: 'THX CINEMA', 57: 'THX SURROUND EX',
  58: 'PL2x MOVIE + THX CINEMA (2)', 59: 'ES Neo:6 + THX CINEMA', 60: 'ES MATRIX + THX CINEMA',
  61: 'ES DISCRETE + THX CINEMA', 62: 'THX SELECT2 CINEMA', 63: 'THX SELECT2 MUSIC', 64: 'THX SELECT2 GAMES (2)',
  65: 'THX ULTRA2 CINEMA', 66: 'THX ULTRA2 MUSIC', 67: 'ES 8ch DISCRETE + THX CINEMA', 68: 'THX CINEMA (2)',
  69: 'THX MUSIC (2)', 70: 'THX GAMES (2)', 71: 'PL2 MUSIC + THX MUSIC', 72: 'PL2x MUSIC + THX MUSIC',
  73: 'Neo:6 MUSIC + THX MUSIC', 74: 'PL2 GAME + THX GAMES', 75: 'PL2x GAME + THX GAMES', 76: 'THX ULTRA2 GAMES',
  77: 'PROLOGIC + THX MUSIC', 78: 'PROLOGIC + THX GAMES', 79: 'THX ULTRA2 GAMES (2)', 80: 'THX MUSIC',
  81: 'THX GAMES', 82: 'PL2x MUSIC + THX MUSIC (2)', 83: 'EX + THX GAMES', 84: 'Neo:6 + THX MUSIC',
  85: 'Neo:6 + THX GAMES', 86: 'ES MATRIX + THX MUSIC', 87: 'ES MATRIX + THX GAMES', 88: 'ES DISCRETE + THX MUSIC',
  89: 'ES DISCRETE + THX GAMES', 90: 'ES 8CH DISCRETE + THX MUSIC', 91: 'ES 8CH DISCRETE + THX GAMES',
  92: 'PL2z HEIGHT + THX CINEMA', 93: 'PL2z HEIGHT + THX MUSIC', 94: 'PL2z HEIGHT + THX GAMES',
  95: 'PL2z HEIGHT + THX CINEMA (2)', 96: 'PL2z HEIGHT + THX MUSIC (2)', 97: 'PL2z HEIGHT + THX GAMES (2)',
  101: 'ACTION', 102: 'SCI-FI', 103: 'DRAMA', 104: 'ENTERTAINMENT SHOW', 105: 'MONO FILM', 106: 'EXPANDED THEATER',
  107: 'CLASSICAL', 109: 'UNPLUGGED', 110: 'ROCK/POP', 112: 'EXTENDED STEREO', 113: 'PHONES SURROUND',
  116: 'TV SURROUND', 117: 'SPORTS', 118: 'ADVANCED GAME', 151: 'Auto Level Control', 152: 'OPTIMUM SURROUND',
  153: 'RETRIEVER AIR', 200: 'ECO MODE', 201: 'Neo:X CINEMA + THX CINEMA', 202: 'Neo:X MUSIC + THX MUSIC',
  203: 'Neo:X GAME + THX GAMES', 204: 'Neo:X CINEMA + THX CINEMA (2)', 205: 'Neo:X MUSIC + THX MUSIC (2)',
  206: 'Neo:X GAME + THX GAMES (2)', 212: 'ECO MODE 1', 213: 'ECO MODE 2',
};
const LISTENING_MODES = Object.fromEntries(Object.entries(MODE_TABLE).map(([k, v]) => [pad(k, 4), v]));

// Modes réservés aux sources stéréo ou multicanal, et particularités de certains modèles (d'après aiopioneer).
const ids = (...parts) => parts.flatMap((p) => (Array.isArray(p) ? Array.from({ length: p[1] - p[0] + 1 }, (_, i) => p[0] + i) : [p])).map((n) => pad(n, 4));
const OFF_SC_LX79 = ids(4, 11, 16, 17, 25, 28, 29, 53, 55, 59, 73, [76, 78], [83, 85], 102, [104, 106], 109, 116);
const OFF_SC_2023 = ids(4, 11, 16, 17, 25, 28, 29, [51, 97], 102, [104, 106], 109, 116, 152, [201, 206]);
// Pioneer eISCP (via lib/eiscp.js) : code LMD hexadécimal → identifiant 5000 + valeur. Spécification Pioneer ISCP v1.04.
const EISCP_MODES = {
  0x00: 'STEREO', 0x01: 'DIRECT', 0x02: 'SURROUND', 0x03: 'FILM / GAME RPG', 0x04: 'THX', 0x05: 'ACTION / GAME ACTION',
  0x06: 'MUSICAL / GAME ROCK', 0x07: 'MONO MOVIE', 0x08: 'ORCHESTRA', 0x09: 'UNPLUGGED', 0x0a: 'STUDIO-MIX', 0x0b: 'TV LOGIC',
  0x0c: 'ALL CH STEREO', 0x0d: 'THEATER-DIMENSIONAL', 0x0e: 'ENHANCED / GAME SPORTS', 0x0f: 'MONO', 0x11: 'PURE DIRECT',
  0x12: 'MULTIPLEX', 0x13: 'FULL MONO', 0x14: 'Dolby Virtual', 0x17: 'DTS Virtual:X', 0x1f: 'Whole House', 0x40: 'Straight Decode',
  0x41: 'Dolby EX', 0x80: 'Dolby Surround', 0x81: 'PRO LOGIC II MUSIC', 0x82: 'DTS Neural:X', 0x83: 'Neo:6 MUSIC',
  0x86: 'PRO LOGIC II GAME', 0xff: 'AUTO SURROUND',
};
for (const [k, v] of Object.entries(EISCP_MODES)) LISTENING_MODES[pad(5000 + +k, 4)] = v;
const MODE_RULES = {
  // Modes proposés sur un Pioneer eISCP (ceux que la spécification Pioneer déclare pris en charge)
  eiscp: ids(5000, 5001, 5003, 5005, 5006, 5008, 5009, [5010, 5015], 5017, 5019, 5031, 5064, 5128, 5129, 5130, 5131, 5134, 5255),
  twoCh: ids([9, 20], [68, 70], [92, 94], [201, 203]),   // seulement avec une source 2 canaux
  multi: ids([21, 27], 30, [34, 36], [43, 45], [56, 67], [79, 91], [95, 97], [204, 206]),   // seulement en multicanal
  models: [
    { re: '^VSX-930', names: { '0040': 'Dolby Surround', '0041': 'EXTENDED STEREO', '0100': 'ADVANCED SURROUND' }, only: ids([5, 10], 16, 40, 41, 100, 151, 212) },
    { re: '^(SC-LX(57|77|79|87)|SC-7[257]|SC-1[35]2[38])', off: OFF_SC_LX79 },
    { re: '^(SC-(2023|1223)|VSX-(1123|923))', off: OFF_SC_2023 },
  ],
};

// Paramètres du récepteur lus par "?CODE" -> "CODE<valeur>" et écrits par "<valeur><CODE>".
//   bool  : 0/1            enum : liste d'options {code: libellé}
//   range : valeur = (code - codeOffset) * codeStep, bornes min..max, `width` chiffres
// `group` range les paramètres dans l'interface ; `hint` s'affiche sous le libellé.
const bool = (label, group, hint, extra = {}) => ({ type: 'bool', label, group, hint, width: 1, ...extra });
const list = (label, group, options, extra = {}) => ({ type: 'enum', label, group, options, width: 1, ...extra });
const range = (label, group, r) => ({ type: 'range', label, group, width: 1, codeStep: 1, codeOffset: 0, ...r });

const PARAMS = {
  // Dialogue, dynamique et basses
  ATH: list('Dialog Enhancement', 'dialogue', { 0: 'Off', 1: 'Flat', 2: 'Up 1', 3: 'Up 2', 4: 'Up 3', 5: 'Up 4' }, { hint: "Fait ressortir la voix dans le canal centre. Flat = neutre ; Up 1 à 4 remontent peu à peu l'image sonore de la voix. Indisponible en Pure Direct, Direct ou THX selon le modèle" }),
  ATL: list('Dynamic Range', 'dialogue', { 0: 'Off', 1: 'Auto', 2: 'Mid', 3: 'Max' }, { hint: 'Compresse les écarts de volume (soirée)' }),
  ATM: list('LFE Attenuator', 'dialogue', { 0: '0 dB', 1: '-5 dB', 2: '-10 dB', 3: '-15 dB', 4: '-20 dB', 5: 'Coupé' }, { hint: 'Atténue les effets basses fréquences (valeurs confirmées sur VSX-1021)', wide: ['00', '05', '10', '15', '20', '50'] }),
  ATW: bool('Loudness Management', 'dialogue', 'Garde un son équilibré à faible volume (modèles récents)'),
  ATG: bool('Digital Noise Reduction', 'dialogue', 'Réduit le bruit d\'une source bruyante (cassette vidéo…). Sans effet sur les signaux multicanaux'),
  ATN: list('SACD Gain', 'dialogue', { 0: '0 dB', 1: '+6 dB' }),
  ATK: bool('Fixed PCM', 'dialogue'),
  ATJ: list('Dual Mono', 'dialogue', { 0: 'CH1+CH2', 1: 'CH1', 2: 'CH2' }),
  // Espace et effets
  ATP: range('Center Width', 'espace', { min: 0, max: 7 }),
  ATS: range('Center Image', 'espace', { min: 0, max: 1, step: 0.1, codeStep: 0.1, width: 2 }),
  ATR: range('Dimension', 'espace', { min: -3, max: 3, codeOffset: 50, width: 2 }),
  ATT: range('Effect', 'espace', { min: 10, max: 90, step: 10, codeStep: 10, width: 2 }),
  ATQ: bool('Panorama', 'espace'),
  ATU: list('Height Gain', 'espace', { 0: 'Low', 1: 'Mid', 2: 'High' }),
  VSB: bool('Virtual Surround Back', 'espace'),
  VWD: bool('Virtual Wide', 'espace', 'Élargit la scène avant avec des enceintes virtuelles (modèles récents)'),
  VDP: list('Virtual Depth', 'espace', { 0: 'Off', 1: 'Min', 2: 'Mid', 3: 'Max' }, { hint: 'Donne de la profondeur à la scène sonore (modèles récents)' }),
  VSP: list('Virtual Speakers', 'espace', { 0: 'Auto', 1: 'Manuel' }, { hint: 'Enceintes virtuelles (modèles récents)' }),
  ARA: bool('Center Spread', 'espace', 'Étale le centre sur les enceintes avant (modèles récents)'),
  ARB: list('Rendering Mode', 'espace', { 0: 'Object base', 1: 'Channel base' }, { hint: 'Dolby Atmos / DTS:X : rendu par objets ou par canaux (modèles récents)' }),
  VHT: bool('Virtual Height', 'espace'),
  // Synchro et correction
  ATF: range('Sound Delay', 'synchro', { min: 0, max: 10, step: 0.1, codeStep: 0.1, width: 3, unit: 'images', hint: "Décalage image/son (0,1 image par pas, confirmé sur l'afficheur)" }),
  ATO: bool('Auto Delay', 'synchro'),
  ATE: range('Phase Control Plus', 'synchro', { min: 0, max: 16, width: 2, unit: 'ms', autoCodes: [97, 98, 99] }),
  IS: list('Phase Control', 'synchro', { 0: 'Off', 1: 'On', 2: 'Full band' }, { hint: 'Aligne les phases entre canaux (le canal LFE des disques non conformes est décalé : corrige ce retard)' }),
  ATC: bool('Equalizer (MCACC)', 'correction', 'Corrige l\'acoustique de la pièce et les différences entre enceintes vers un champ sonore idéal'),
  ATD: bool('Standing Wave', 'correction', 'Atténue les ondes stationnaires de la pièce (Standing Wave Control)'),
  MC: list('Mémoire MCACC', 'correction', { 1: 'M1', 2: 'M2', 3: 'M3', 4: 'M4', 5: 'M5', 6: 'M6' }),
  // Signal
  PQ: list('PQLS', 'signal', { 0: 'Off', 1: 'Auto' }),
  ATA: bool('Sound Retriever', 'signal', 'Restaure la pression sonore et lisse les artefacts des musiques compressées (MP3…)'),
  SDA: list('Signal Select', 'signal', { 0: 'Auto', 1: 'Analog', 2: 'Digital', 3: 'HDMI' }),
  SDB: bool('Input Attenuator', 'signal'),
  ATY: list('Audio Scaler', 'signal', { 0: 'Auto', 1: 'Manuel' }, { hint: 'Remise à l\'échelle audio haute résolution (modèles récents)' }),
  ATI: bool('Hi-Bit', 'signal', 'Traitement 32 bits (modèles récents)'),
  ATZ: list('Up Sampling', 'signal', { 0: 'Off', 1: 'x2', 2: 'x4' }, { hint: 'Suréchantillonnage (modèles récents)' }),
  ATV: list('Digital Filter', 'signal', { 0: 'Slow', 1: 'Sharp', 2: 'Short' }, { hint: 'Filtre du convertisseur numérique-analogique (modèles récents)' }),
  // Système d'enceintes (lu via 'spk')
  SPK: list("Système d'enceintes", 'enceintes', { 0: 'Off', 1: 'A', 2: 'B / FH (hauteur)', 3: 'A+B' }, { hint: 'SPK2 affiche « FH ON » sur le VSX-1021' }),

  // ----- Installation : touche à la calibration de la salle -> confirmation avant écriture (risky) -----
  SSQ: list('Fréquence de coupure (X-over)', 'installation', { 0: '50 Hz', 1: '80 Hz', 2: '100 Hz', 3: '150 Hz', 4: '200 Hz' }, { risky: true }),
  SSP: list('Position des surround', 'installation', { 0: 'Côté', 1: 'Arrière' }, { risky: true }),
  SST: range('Courbe X', 'installation', { min: -3, max: 0, step: 0.5, codeStep: -0.5, unit: 'dB', risky: true }),
  SSF: list('Configuration des enceintes', 'installation', {
    0: 'Normal / 5.2.2ch / 7.2ch', 1: '7.2ch SB/FW', 2: 'Speaker B', 3: 'Front Bi-Amp', 4: 'Zone 2', 5: 'HDZone', 7: '5.2ch',
    8: 'Front Bi-Amp', 9: 'Speaker B', 10: '9.1ch FH/FW', 11: '7.2.2/7.2ch +SP-B', 12: '7.2ch Front Bi-Amp', 13: '7.2ch + HDZONE',
    14: '7.1ch FH/FW + ZONE 2', 15: '5.2ch Bi-Amp + HDZONE', 16: '5.2ch + ZONE 2+3', 17: '5.2ch + SP-B Bi-Amp', 18: '5.2ch F+Surr Bi-Amp',
    19: '5.2ch F+C Bi-Amp', 20: '5.2ch C+Surr Bi-Amp', 21: 'Multi-ZONE Music', 22: '7.2.2ch TMd/FW', 23: '7.2.2ch TMd/FH', 24: '5.2.4ch',
    25: '5.2ch ZONE 2 + HDZONE', 26: '7.2.2/5.2.2/7.2ch', 27: '7.2.2ch Front Bi-Amp', 30: '9.2.2ch TMd/FH', 31: '7.2.4ch SB Pre Out', 32: '7.2.4ch Front Pre Out',
  }, {
    width: 2, risky: true, hint: 'Les options varient selon le modèle',
    // Famille SC-LX79 et apparentés (aiopioneer) : autre liste, mêmes codes
    byModel: [{ re: '^(SC-LX(57|77|79|87)|SC-7[1257]|SC-1[2-5]2[38]|SC-2023|VSX-(1123|1128|1028|923))', options: {
      0: 'Normal (SB/FH)', 1: 'Normal (SB/FW)', 2: 'Speaker B', 3: 'Front Bi-Amp', 4: 'Zone 2', 10: '9.1ch FH/FW', 11: '7.1ch + Speaker B',
      12: '7.1ch Front Bi-Amp', 13: '7.1ch + ZONE2', 14: '7.1ch FH/FW + ZONE 2', 15: '5.1ch Bi-Amp + ZONE2', 16: '5.1ch + ZONE 2+3',
      17: '5.1ch + SP-B Bi-Amp', 18: '5.1ch F+Surr Bi-Amp', 19: '5.1ch F+C Bi-Amp', 20: '5.1ch C+Surr Bi-Amp', 21: 'Multi-ZONE Music',
    } }],
  }),
  STX: bool('Lien enceintes B', 'installation', null, { risky: true }),
  SSU: bool('Loudness Plus', 'installation', null, { readOnly: true }),
  SSV: list('Traitement SB (THX)', 'installation', { 0: 'Auto', 1: 'Manuel' }, { readOnly: true }),
  SSW: bool('THX Ultra / Select2', 'installation', null, { readOnly: true }),
  SSX: bool('Compression Boundary Gain', 'installation', 'Compense l\'excès de graves quand le caisson est près d\'un mur ou d\'un angle', { readOnly: true }),
  SSB: bool('Ré-égalisation', 'installation', null, { readOnly: true }),
  // ----- HDMI -----
  HO: list('Sortie HDMI', 'hdmi', { 0: 'Toutes', 1: 'HDMI 1', 2: 'HDMI 2' }),
  HDO: list('Sortie HDMI 3', 'hdmi', { 1: 'On', 3: 'Off' }),
  HA: list('Audio HDMI', 'hdmi', { 0: 'Ampli', 1: 'Passthrough (TV)' }),
  STQ: bool('Contrôle HDMI', 'hdmi'),
  STR: bool('Mode contrôle HDMI', 'hdmi'),
  STT: bool('ARC HDMI', 'hdmi'),
  SVL: bool('PQLS pour sauvegarde', 'hdmi'),
  STU: list('Passthrough en veille', 'hdmi', { 0: 'Off', 1: 'Dernière entrée', 2: 'BD', 3: 'HDMI 1', 4: 'HDMI 2', 5: 'HDMI 3', 6: 'HDMI 4', 7: 'HDMI 5', 8: 'HDMI 6', 9: 'HDMI 7', 10: 'HDMI 8' }, { width: 2 }),
  STV: list('Déclencheur 12 V n°1', 'hdmi', { 0: 'Off', 1: 'Sortie HDMI 1', 2: 'Sortie HDMI 2', 3: 'Sortie HDMI 3', 4: 'Sortie HDMI 4 / HDBaseT' }),
  STW: list('Déclencheur 12 V n°2', 'hdmi', { 0: 'Off', 1: 'Sortie HDMI 1', 2: 'Sortie HDMI 2', 3: 'Sortie HDMI 3', 4: 'Sortie HDMI 4 / HDBaseT' }),
  // ----- Gestion de l'ampli -----
  SAC: list('Mode ampli', 'gestion', { 0: 'Ampli on', 1: 'Avant coupé', 2: 'Avant + centre coupés', 3: 'Ampli off' }),
  SAB: list('Minuterie de veille', 'gestion', { 0: 'Off', 30: '30 min', 60: '60 min', 90: '90 min' }, { width: 3, hint: 'Programme l\'extinction automatique' }),
  SAA: list("Luminosité de l'afficheur", 'gestion', { 0: 'Maximale', 1: 'Forte', 2: 'Faible', 3: 'Éteint' }, { writeOnly: true, hint: "L'ampli ne permet pas de lire ce réglage" }),
  PKL: list('Verrou face avant', 'gestion', { 0: 'Off', 1: 'Face avant', 2: 'Face avant + volume' }, { risky: true, hint: 'Verrouille les touches de l\'ampli' }),
  RML: bool('Verrou télécommande', 'gestion', 'Désactive la télécommande infrarouge', { risky: true }),
  SSE: list("Langue de l'affichage", 'gestion', { 0: 'English', 1: 'Français', 3: 'Deutsch', 4: 'Italiano', 5: 'Español', 6: 'Nederlands', 7: 'Русский', 8: '中文 (简体)', 9: '中文 (繁體)', 10: '日本語' }, { width: 2 }),
  STJ: bool('Veille réseau', 'gestion', 'Garde le réseau actif en veille (nécessaire pour allumer à distance)'),
  SVA: bool("Surimpression à l'écran (OSD)", 'gestion'),
};
// Groupes capturés par les presets (les réglages d'installation et de gestion n'en font jamais partie).
const PRESET_GROUPS = ['dialogue', 'espace', 'synchro', 'correction', 'signal'];
const { PARAM_HELP, VIDEO_HELP, GLOSSARY } = require('./help');
for (const [k, text] of Object.entries(PARAM_HELP)) if (PARAMS[k]) PARAMS[k].help = text;
const paramFromCode = (def, code) => (code - (def.codeOffset || 0)) * (def.codeStep || 1);
const paramToCode = (def, value) => Math.round(value / (def.codeStep || 1)) + (def.codeOffset || 0);
// Commande d'écriture d'un paramètre, valeur déjà exprimée en code ("1IS", "06ATE", "050ATF"…).
// wide : réglages reçus sur 2 chiffres (voir ATM) ; on répond dans le même format.
const paramCommand = (code, v, wide) => (wide?.[code] && PARAMS[code].wide?.[v] ? `${PARAMS[code].wide[v]}${code}` : `${pad(v, PARAMS[code].width)}${code}`);

const CMD = {
  powerOn: 'PO', powerOff: 'PF',
  volumeUp: 'VU', volumeDown: 'VD', volumeSet: (n) => `${pad(n, 3)}VL`,
  muteOn: 'MO', muteOff: 'MF',
  inputSet: (id) => `${id}FN`, inputNext: 'FU', inputPrev: 'FD',
  modeSet: (id) => `${id}SR`,
  z2PowerOn: 'APO', z2PowerOff: 'APF', z2VolUp: 'ZU', z2VolDown: 'ZD',
  z2VolSet: (n) => `${pad(n, 2)}ZV`, z2MuteOn: 'Z2MO', z2MuteOff: 'Z2MF',
  z2InputSet: (id) => `${id}ZS`,
  z3PowerOn: 'BPO', z3PowerOff: 'BPF', z3VolUp: 'YU', z3VolDown: 'YD',
  z3VolSet: (n) => `${pad(n, 2)}YV`, z3MuteOn: 'Z3MO', z3MuteOff: 'Z3MF',
  z3InputSet: (id) => `${id}ZT`,
  // HDZone (haut de gamme, sortie HDMI 2 / zone HDMI) : volume seulement si le système d'enceintes l'alimente
  hdzPowerOn: 'ZEO', hdzPowerOff: 'ZEF', hdzVolUp: 'HZU', hdzVolDown: 'HZD', hdzVolSet: (n) => `${pad(n, 2)}HZV`,
  hdzMuteOn: 'HZMO', hdzMuteOff: 'HZMF', hdzInputSet: (id) => `${id}ZEA`,
  tunerFreqUp: 'TFI', tunerFreqDown: 'TFD', tunerPresetUp: 'TPI', tunerPresetDown: 'TPD',
  toneOn: '1TO', toneOff: '0TO', bassUp: 'BI', bassDown: 'BD', trebleUp: 'TI', trebleDown: 'TD',
  bassSet: (n) => `${pad(6 - n, 2)}BA`, trebleSet: (n) => `${pad(6 - n, 2)}TR`,
  tunerPreset: (id) => `${id}PR`,                     // ex. "A01PR"
  speakerSet: (n) => `${n}SPK`,
  levelsSet: (arr) => `${arr.map((v) => pad(v, 2)).join('')}ILV`,
  eqSet: (arr) => `${arr.map((v) => pad(v, 2)).join('')}ATB`,
  sscSet: (cc, ii, vv) => `${pad(cc, 2)}${pad(ii, 2)}${pad(vv, 2)}SSC`,
  // Niveau d'un canal sur les modèles à commande CLV : "<canal sur 3 car.><code sur 2 chiffres>CLV"
  clvSet: (ch, unit) => `${CLV_CODES[ch]}${pad(unit, 2)}CLV`,
  // Zone 2 : tonalité
  z2ToneOn: '1ZGA', z2ToneOff: '0ZGA', z2BassSet: (n) => `${pad(6 - n, 2)}ZGB`, z2TrebleSet: (n) => `${pad(6 - n, 2)}ZGC`,
  // Touches de la télécommande (navigation dans les menus de l'ampli)
  keyUp: 'CUP', keyDown: 'CDN', keyLeft: 'CLE', keyRight: 'CRI', keyEnter: 'CEN', keyReturn: 'CRT', keyHome: 'HM',
  keyStatus: 'STS', keyAudioParam: 'ATA', keyVideoParam: 'VPA', keyOutputParam: 'HPA', keyChannel: 'CLC', keyOff: 'KOF',
  // Tuner
  tunerBandFm: '00TN', tunerBandAm: '01TN', tunerDirect: 'TAC', tunerDigit: (n) => `${n}TP`,
  // Entrées : renommer / rétablir le nom par défaut
  // Niveau d'entrée par source (modèles récents) : 26..74, 50 = 0 dB
  inputLevelSet: ([id, u]) => `${id}${pad(Math.max(26, Math.min(74, u)), 2)}ILA`,
  inputRename: (id, name) => `1RGB${id}${name}`, inputRenameReset: (id) => `0RGB${id}`,
};

// Ordre des canaux : drapeaux de sortie de ?AST (SW en 8) et niveaux ILV.
const CHANNELS = ['FL', 'C', 'FR', 'SL', 'SR', 'SBL', 'SB', 'SBR', 'SW', 'FHL', 'FHR', 'FWL', 'FWR', 'TML', 'TMR', 'TRL', 'TRR', 'SW2'];
// Ordre des canaux d'entrée de ?AST (LFE en 8).
const INPUT_CHANNELS = ['FL', 'C', 'FR', 'SL', 'SR', 'SBL', 'SB', 'SBR', 'SW', 'FHL', 'FHR', 'FWL', 'FWR', 'XL', 'XC', 'XR'];
const CHANNEL_NAMES = {
  FL: 'Avant G', C: 'Centre', FR: 'Avant D', SL: 'Surround G', SR: 'Surround D', SBL: 'Arrière G', SB: 'Arrière centre',
  SBR: 'Arrière D', SW: 'Caisson', FHL: 'Hauteur G', FHR: 'Hauteur D', FWL: 'Large G', FWR: 'Large D',
};
// Égaliseur graphique : valeur 50 = 0 dB, 1 unité = 0,5 dB, plage ±6 dB (38..62).
const EQ_BANDS = ['Mode', '31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_RANGE = { min: 38, max: 62 };

const paramQueries = Object.keys(PARAMS).filter((k) => k !== 'SPK' && !PARAMS[k].writeOnly).map((k) => `?${k}`);
const CLV_QUERIES = Object.values(CLV_CODES).map((c) => `?${c}CLV`);
const QUERIES = ['?P', '?V', '?M', '?F', '?S', '?FL', '?AP', '?ZV', '?ZS', '?Z2M', '?BP', '?YV', '?ZT', '?Z3M', '?ZEP', '?HZV', '?ZEA', '?HZM', '?FR', '?PR', '?SUQ',
  '?TO', '?BA', '?TR', '?SPK', '?AST', '?ILV', '?ATB', ...paramQueries, '?L', '?RGD', '?SSI', '?SVB', '?SSO',
  '?ZGA', '?ZGB', '?ZGC', ...CLV_QUERIES, '?SSG', '?SSR', '?SSS',
  '?SSA', '?VTA', '?VST', ...'BCDEFGHIJKLMNOPQRST'.split('').map((c) => `?VT${c}`)];
const INPUT_NAME_QUERIES = INPUT_IDS.map((id) => `?RGB${id}`);
const TUNER_NAME_QUERY = '?TQ';
const SSC_ITEMS = ['0001', '0002', '0003', '0101', '0102', '0103', '0201', '0202', '0203', '0301', '0302', '0303',
  '0401', '0402', '0403', '0501', '0502', '0503', '1001', '1002', '1003', '1201', '1202', '1203'];

function newState() {
  return {
    power: null, volume: null, mute: null, input: null, mode: null, display: '',
    z2: { power: null, volume: null, mute: null, input: null, tone: null, bass: null, treble: null },
    z3: { power: null, volume: null, mute: null, input: null },
    hdz: { power: null, volume: null, mute: null, input: null },
    tuner: { band: null, freq: null, preset: null, names: {} },
    tone: null, bass: null, treble: null,
    levels: null, levelsMode: null, eq: null, spk: null, params: {}, video: {}, ssc: {}, names: {}, audio: null, lm: null,
    model: null, firmware: null, mac: null, friendlyName: null, speakerSetup: {}, mcacc: {}, distances: {}, inputLevels: {}, videoInfo: null,
  };
}

const volumeDb = (v) => (v === null ? null : (v - 161) / 2);

function decodeDisplay(hex) {
  // `hex` = ce qui suit "FL" : 1 octet de flags (2 hex) puis 14 caractères ASCII (28 hex)
  const body = hex.slice(2);
  let s = '';
  for (let i = 0; i + 1 < body.length; i += 2) {
    const c = parseInt(body.slice(i, i + 2), 16);
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
  }
  return s.trim();
}

const PARAM_RE = new RegExp(`^(${Object.keys(PARAMS).filter((k) => k !== 'SPK').join('|')})(\\d+)$`);

// Retourne un événement {path, value} ou {error}/{ack} ou null.
function parseLine(line) {
  line = line.trim();
  if (!line) return null;
  let m;
  if ((m = /^PWR([012])$/.exec(line))) return { path: 'power', value: m[1] === '0' };
  if ((m = /^VOL(\d{3})$/.exec(line))) return { path: 'volume', value: +m[1] };
  if ((m = /^MUT([01])$/.exec(line))) return { path: 'mute', value: m[1] === '0' };
  if ((m = /^FN(\d{2})$/.exec(line))) return { path: 'input', value: m[1] };
  if ((m = /^SR(\d{4})$/.exec(line))) return { path: 'mode', value: m[1] };
  if ((m = /^FL([0-9A-F]+)$/i.exec(line))) return { path: 'display', value: decodeDisplay(m[1]) };
  if ((m = /^APR([012])$/.exec(line))) return { path: 'z2.power', value: m[1] === '0' };
  if ((m = /^ZV(\d{2})$/.exec(line))) return { path: 'z2.volume', value: +m[1] };
  if ((m = /^Z2MUT([01])$/.exec(line))) return { path: 'z2.mute', value: m[1] === '0' };
  if ((m = /^Z2F(\d{2})$/.exec(line))) return { path: 'z2.input', value: m[1] };
  if ((m = /^BPR([012])$/.exec(line))) return { path: 'z3.power', value: m[1] === '0' };
  if ((m = /^YV(\d{2})$/.exec(line))) return { path: 'z3.volume', value: +m[1] };
  if ((m = /^Z3MUT([01])$/.exec(line))) return { path: 'z3.mute', value: m[1] === '0' };
  if ((m = /^Z3F(\d{2})$/.exec(line))) return { path: 'z3.input', value: m[1] };
  if ((m = /^ZEP([012])$/.exec(line))) return { path: 'hdz.power', value: m[1] === '0' };
  if ((m = /^(?:XV|HZV)(\d{2})$/.exec(line))) return { path: 'hdz.volume', value: +m[1] };
  if ((m = /^HZMUT([01])$/.exec(line))) return { path: 'hdz.mute', value: m[1] === '0' };
  if ((m = /^ZEA(\d{2})$/.exec(line))) return { path: 'hdz.input', value: m[1] };
  if (line === 'EISCP1') return { path: 'protocol', value: 'eiscp' };   // repère du pont eISCP (lib/eiscp.js)
  if ((m = /^ILA(\d{2})(\d{2})$/.exec(line))) return { path: `inputLevels.${m[1]}`, value: +m[2] };
  if ((m = /^SUQ([01])$/.exec(line))) return { path: 'tuner', value: { amStep: m[1] === '0' ? 9 : 10 } };
  if ((m = /^FRF(\d{5})$/.exec(line))) return { path: 'tuner', value: { band: 'FM', freq: +m[1] / 100 } };
  if ((m = /^FRA(\d{5})$/.exec(line))) return { path: 'tuner', value: { band: 'AM', freq: +m[1] } };
  if ((m = /^PR([A-G])(\d{2})$/.exec(line))) return { path: 'tuner.preset', value: m[1] + m[2] };
  if ((m = /^TO([01])$/.exec(line))) return { path: 'tone', value: m[1] === '1' };
  if ((m = /^BA(\d{2})$/.exec(line))) return { path: 'bass', value: 6 - +m[1] };
  if ((m = /^TR(\d{2})$/.exec(line))) return { path: 'treble', value: 6 - +m[1] };
  if ((m = /^ILV((?:\d{2}){7,})$/.exec(line))) return { path: 'levels', value: m[1].match(/\d{2}/g).map(Number), mode: 'ILV' };
  if ((m = /^ATB((?:\d{2}){4,})$/.exec(line))) return { path: 'eq', value: m[1].match(/\d{2}/g).map(Number) };
  if ((m = /^CLV([A-Z][A-Z0-9_]{2})(\d{2})$/.exec(line))) return CLV_NAMES[m[1]] ? { path: 'levels.clv', value: { ch: CLV_NAMES[m[1]], unit: +m[2] } } : null;
  if ((m = /^ZGA([01])$/.exec(line))) return { path: 'z2.tone', value: m[1] === '1' };
  if ((m = /^ZGB(\d{2})$/.exec(line))) return { path: 'z2.bass', value: 6 - +m[1] };
  if ((m = /^ZGC(\d{2})$/.exec(line))) return { path: 'z2.treble', value: 6 - +m[1] };
  if ((m = /^RGD(.*)$/.exec(line))) { const mm = /<([^>/]{5,})(\/.[^>]*)?>/.exec(m[1]); return { path: 'model', value: mm ? mm[1] : (m[1].trim() || null) }; }
  if ((m = /^SSI(.*)$/.exec(line))) { const mm = /"([^)]*)"/.exec(m[1]); return { path: 'firmware', value: mm ? mm[1] : (m[1].trim() || null) }; }
  if ((m = /^SVB(.+)$/.exec(line))) return { path: 'mac', value: m[1].trim() };
  if ((m = /^SSO(.+)$/.exec(line))) return { path: 'friendlyName', value: m[1].trim() };
  if ((m = /^SSG(\d{2})(\d)$/.exec(line))) return { path: `speakerSetup.${m[1]}`, value: +m[2] };
  if ((m = /^SSR(\d{2})([A-Z_]{3})(\d{2})$/.exec(line))) return CLV_NAMES[m[2]] ? { path: `mcacc.${m[1]}.${CLV_NAMES[m[2]]}`, value: (+m[3] - 50) / 2 } : null;
  if ((m = /^SSS(\d{2})([A-Z_]{3})(\d{7})$/.exec(line))) return CLV_NAMES[m[2]] ? { path: `distances.${m[1]}.${CLV_NAMES[m[2]]}`, value: m[3] } : null;
  if ((m = /^SPK(\d)$/.exec(line))) return { path: 'spk', value: +m[1] };
  if ((m = PARAM_RE.exec(line))) {
    // Réponse sur 2 chiffres d'un réglage codé sur 1 chiffre ailleurs (ATM des modèles FY14+) : position la plus proche
    const wide = PARAMS[m[1]].wide;
    if (wide && m[2].length === 2) {
      const v = +m[2], i = wide.reduce((best, c, j) => (Math.abs(+c - v) < Math.abs(+wide[best] - v) ? j : best), 0);
      return { path: `params.${m[1]}`, value: i, wide: true };
    }
    return { path: `params.${m[1]}`, value: +m[2] };
  }
  if ((m = /^SSA(\d)$/.exec(line))) return { path: 'params.SSA', value: +m[1] };
  if ((m = /^LM([0-9a-f]{4})$/i.exec(line))) return { path: 'lm', value: m[1] };
  // AST : signal(2) fréq(2) canaux d'entrée(16) réservé(5) canaux de sortie(18 sur FY11)
  if ((m = /^AST(\d{2})(\d{2})(\d{16})\d{5}(\d{8,})$/.exec(line))) {
    const value = { signal: m[1], freq: m[2], input: [...m[3]].map((c) => c !== '0'), output: [...m[4].slice(0, 18)].map((c) => c !== '0') };
    // Réponse longue (FY16+, d'après aiopioneer) : fréquence et bits de sortie, PQLS, Auto Phase Control Plus, phase inversée
    const x = m[4];
    if (x.length >= 30) Object.assign(value, { outFreq: x.slice(18, 20), outBits: +x.slice(20, 22), pqls: +x[26], apcPlus: +x.slice(27, 29), reversePhase: x[29] === '1' });
    return { path: 'audio', value };
  }
  if ((m = /^VT([B-T])(\d+)$/.exec(line))) return { path: `video.${m[1]}`, value: m[2] };
  if ((m = /^(VTA|VST)(\d+)$/.exec(line))) return { path: `video.${m[1]}`, value: m[2] };
  if ((m = /^SSC(\d{2})(\d{2})(\d{2})$/.exec(line))) return { path: `ssc.${m[1]}${m[2]}`, value: +m[3] };
  if ((m = /^RGB(\d{2})([01])(.*)$/.exec(line))) return { path: `names.${m[1]}`, value: m[3].trim() };
  if ((m = /^TQ([A-G])(\d)"(.*)"$/.exec(line))) return { path: `tuner.names.${m[1]}${m[2]}`, value: m[3].trim() };
  if ((m = /^E(\d{2})$/.exec(line))) return { error: m[1] };
  if (line === 'R') return { ack: true };
  if (line === 'B00') return { busy: true };
  return null;
}

const VIDEO_TERMINAL = { 1: 'VIDEO', 2: 'S-VIDEO', 3: 'COMPONENT', 4: 'HDMI', 5: 'Self OSD/JPEG' };
const VIDEO_FORMAT = { 1: '480/60i', 2: '576/50i', 3: '480/60p', 4: '576/50p', 5: '720/60p', 6: '720/50p', 7: '1080/60i', 8: '1080/50i', 9: '1080/60p',
  10: '1080/50p', 11: '1080/24p', 12: '4Kx2K/24Hz', 13: '4Kx2K/25Hz', 14: '4Kx2K/30Hz', 15: '4Kx2K/24Hz (SMPTE)', 16: '4Kx2K/50Hz', 17: '4Kx2K/60Hz' };
const VIDEO_ASPECT = { 1: '4:3', 2: '16:9', 3: '14:9' };
const VIDEO_COLOR = { 1: 'RGB Limit', 2: 'RGB Full', 3: 'YCbCr 4:4:4', 4: 'YCbCr 4:2:2', 5: 'YCbCr 4:2:0' };
const VIDEO_BITS = { 1: '24 bits', 2: '30 bits', 3: '36 bits', 4: '48 bits' };
// Décode "VST" : borne d'entrée, format, aspect, espace colorimétrique, profondeur (entrée puis sortie).
function decodeVideoStatus(raw) {
  if (!raw || raw.length < 12) return null;
  const n = (a, b) => +raw.slice(a, b);
  const side = (o) => ({ format: VIDEO_FORMAT[n(o, o + 2)] || null, aspect: VIDEO_ASPECT[n(o + 2, o + 3)] || null, color: VIDEO_COLOR[n(o + 3, o + 4)] || null, bits: VIDEO_BITS[n(o + 4, o + 5)] || null });
  return { terminal: VIDEO_TERMINAL[n(0, 1)] || null, input: side(1), output: side(7) };
}

function applyEvent(state, ev) {
  if (!ev || !ev.path) return state;
  if (ev.path === 'tuner') { Object.assign(state.tuner, ev.value); return state; }
  if (ev.path === 'levels.clv') {
    if (!state.levels || state.levelsMode !== 'CLV') { state.levels = Array(CHANNELS.length).fill(50); state.levelsMode = 'CLV'; }
    const i = CHANNELS.indexOf(ev.value.ch);
    if (i >= 0) state.levels[i] = ev.value.unit;
    return state;
  }
  if (ev.path === 'levels') state.levelsMode = 'ILV';
  if (ev.wide) (state.wide ||= {})[ev.path.slice(7)] = true;
  const parts = ev.path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = ev.value;
  if (ev.path === 'video.VST') state.videoInfo = decodeVideoStatus(ev.value);
  return state;
}

module.exports = {
VIDEO_HELP, GLOSSARY,
  CMD, QUERIES, INPUT_NAME_QUERIES, TUNER_NAME_QUERY, SSC_ITEMS, PARAMS, CHANNELS, INPUT_CHANNELS, CHANNEL_NAMES, EQ_BANDS, EQ_RANGE,
  INPUTS, INPUT_IDS, CLV_CODES, CLV_NAMES, PRESET_GROUPS, decodeVideoStatus, LISTENING_MODES, MODE_RULES, MEDIA_SOURCES, mediaCommand, newState, parseLine, applyEvent, volumeDb, decodeDisplay, pad, paramFromCode, paramToCode, paramCommand,
};
