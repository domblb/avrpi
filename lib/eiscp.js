'use strict';
// Pioneer récents (conception Onkyo, ~2016+) : protocole eISCP sur le port 60128 (spécification Pioneer ISCP v1.04).
// EiscpBridge est un socket de même interface que net.Socket, placé entre lib/avr.js et le réseau : l'appli continue de
// parler le protocole ASCII Pioneer (« ?V », « 085VL »…) et le pont traduit dans les deux sens. Ce qui n'a pas
// d'équivalent reçoit « E04 », si bien que l'interface masque d'elle-même les écrans correspondants.
// Non vérifié sur un vrai ampli : formats d'après la spécification et des réponses réelles publiées (projet onpc).
const { EventEmitter } = require('node:events');

const EISCP_PORT = 60128;
// Repère envoyé à l'appli à la connexion (voir parseLine) : l'état sait qu'il parle à un ampli eISCP.
const MARKER = 'EISCP1';

/* --- trames : "ISCP" + taille d'en-tête (16) + taille des données (big-endian) + version 1 + 3 octets réservés --- */
const u32 = (n) => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const rd32 = (s, i) => ((s.charCodeAt(i) << 24) | (s.charCodeAt(i + 1) << 16) | (s.charCodeAt(i + 2) << 8) | s.charCodeAt(i + 3)) >>> 0;
function frame(body) { return `ISCP${u32(16)}${u32(body.length)}\x01\x00\x00\x00${body}`; }
// Le texte est de l'UTF-8 transporté octet par octet (chaînes latin1) : noms d'entrées, titres…
const utf8 = (s) => { try { return new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0))); } catch { return s; } };
const toLatin1 = (s) => Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join('');

// Découpe un flux en messages ; renvoie les corps sans "!1" ni terminateur (EOF 0x1A, CR, LF).
function createDeframer() {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    const out = [];
    for (;;) {
      const i = buf.indexOf('ISCP');
      if (i < 0) { buf = buf.slice(-3); break; }
      if (buf.length < i + 16) { buf = buf.slice(i); break; }
      const hs = rd32(buf, i + 4), ds = rd32(buf, i + 8);
      if (buf.length < i + hs + ds) { buf = buf.slice(i); break; }
      const body = buf.slice(i + hs, i + hs + ds);
      buf = buf.slice(i + hs + ds);
      const m = /^!.(.*?)[\x1a\r\n]*$/s.exec(body);
      if (m) out.push(m[1]);
    }
    return out;
  };
}

/* --- correspondances --- */
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad = (n, w) => String(n).padStart(w, '0');
// Volume : MVL 00..C8 par 0,5 ; sur les Pioneer, 0xA4 (164) ≈ 0 dB d'après volmax="82" (déduit, à confirmer).
// Échelle Pioneer classique : 161 = 0 dB, 0,5 dB par pas → VOL = MVL − 3.
const mvlToVol = (h) => clamp(parseInt(h, 16) - 3, 0, 185);
const volToMvl = (v) => hex2(clamp(v + 3, 0, 200));
// Zones : échelle classique 0..81 (81 = 0 dB, 1 dB par pas) ; ZVL même codage que MVL (déduit).
const zvlToZone = (h) => clamp(Math.round(parseInt(h, 16) / 2) - 1, 0, 81);
const zoneToZvl = (z) => hex2(clamp((z + 1) * 2, 0, 200));
// Entrées : code SLI (hex) → identifiant d'entrée Pioneer classique (icônes et commandes de lecture de l'appli).
const SLI_TO_FN = {
  '00': '15', '01': '06', '02': '49', '03': '29', '04': '14', '05': '27', '10': '25', '11': '10', '12': '05', '20': '03',
  '22': '00', '23': '01', '24': '02', '25': '02', '26': '02', '27': '44', '28': '38', '29': '17', '2A': '16', '2B': '26',
  '2D': '46', '2E': '33', '2F': '13', '30': '12', '33': '55', '55': '23', '56': '24', '57': '34',
};
const SLI_NAMES = {
  '00': 'VIDEO 1', '01': 'CBL/SAT', '02': 'GAME', '03': 'AUX', '04': 'GAME 2', '05': 'PC', '10': 'BD/DVD', '11': 'STRM BOX', '12': 'TV',
  '20': 'TAPE', '22': 'PHONO', '23': 'CD', '24': 'FM', '25': 'AM', '26': 'TUNER', '27': 'MUSIC SERVER', '28': 'INTERNET RADIO',
  '29': 'USB', '2A': 'USB (Rear)', '2B': 'NET', '2D': 'AirPlay', '2E': 'BLUETOOTH', '2F': 'USB DAC', '30': 'MULTI CH', '33': 'DAB',
  '55': 'HDMI 5', '56': 'HDMI 6', '57': 'HDMI 7',
};
// Identifiant Pioneer → code SLI (le tuner passe par 26, la bande se choisit avec 24/25).
const FN_TO_SLI = {};
for (const [s, f] of Object.entries(SLI_TO_FN)) if (!FN_TO_SLI[f] || s === '26') FN_TO_SLI[f] = s;
// Modes d'écoute : code LMD (hex) → identifiant de mode 5000 + valeur (noms dans protocol.js)
const lmdToSr = (h) => pad(5000 + parseInt(h, 16), 4);
const srToLmd = (id) => (+id >= 5000 && +id <= 5255 ? hex2(+id - 5000) : null);
// Lecture : commandes de l'appli (familles NW / IP / BT) → NTC. Avance et retour rapides n'existent pas sur les Pioneer.
const NTC = {
  NW: { 10: 'PLAY', 11: 'PAUSE', 12: 'TRDN', 13: 'TRUP', 20: 'STOP', 34: 'REPEAT', 35: 'RANDOM' },
  IP: { 0: 'PLAY', 1: 'PAUSE', 2: 'STOP', 3: 'TRDN', 4: 'TRUP', 7: 'REPEAT', 8: 'RANDOM' },
  BT: { 10: 'PLAY', 11: 'PAUSE', 12: 'STOP', 13: 'TRDN', 14: 'TRUP', 17: 'REPEAT', 18: 'RANDOM' },
};
// Tonalité : "+3" / "-A" / "00" (hex signé) ↔ dB
const toneVal = (s) => (s === '00' ? 0 : parseInt(s.slice(1), 16) * (s[0] === '-' ? -1 : 1));
const toneStr = (db) => (db === 0 ? '00' : `${db > 0 ? '+' : '-'}${Math.abs(db).toString(16).toUpperCase()}`);
// Présélections : 1..40 ↔ groupes de 9 de l'appli (A1..A9, B1…)
const prsToPr = (n) => `${String.fromCharCode(65 + Math.floor((n - 1) / 9))}${pad(((n - 1) % 9) + 1, 2)}`;
const prToPrs = (g, d) => hex2((g.charCodeAt(0) - 65) * 9 + d);
const hexText = (t) => Array.from(String(t).slice(0, 14).padEnd(14), (c) => (c.charCodeAt(0) < 128 ? c : '?').charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();

// Lecture de la fiche NRI (XML) : modèle, nom, version, zones, entrées, présélections.
function parseNri(xml) {
  const tag = (n) => (new RegExp(`<${n}>([^<]*)</${n}>`).exec(xml) || [])[1] || null;
  const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const list = (n) => [...xml.matchAll(new RegExp(`<${n}\\s([^>]*?)/?>`, 'g'))].map((m) => attrs(m[1]));
  const zones = {};
  for (const z of list('zone')) zones[z.id] = z.value === '1';
  const selectors = list('selector').filter((s) => s.value !== '0' && s.id).map((s) => ({ id: s.id.toUpperCase(), name: s.name, zone: parseInt(s.zone || '01', 16) }));
  const presets = list('preset').filter((p) => p.band && p.band !== '0').map((p) => ({ n: parseInt(p.id, 16), name: p.name || '' }));
  return { model: tag('model'), name: tag('friendlyname'), firmware: tag('firmwareversion'), zones, selectors, presets };
}

class EiscpBridge extends EventEmitter {
  constructor(createRaw, host, port = EISCP_PORT) {
    super();
    this.raw = createRaw(host, port);
    this.deframe = createDeframer();
    this.info = null; this.ready = false; this.closed = false; this.buf = '';
    this.st = { tunerFreq: null };
    const raw = this.raw;
    if (raw.setEncoding) raw.setEncoding('latin1');
    raw.on('connect', () => {
      raw.setKeepAlive?.(true, 10000);
      // Fiche de l'appareil d'abord : modèle, entrées et zones réelles. Sans réponse en 3 s, valeurs par défaut.
      this._tx('NRIQSTN');
      this.nriTimer = setTimeout(() => this._ready(), 3000);
    });
    raw.on('data', (d) => this._rx(d));
    raw.on('timeout', () => this.emit('timeout'));
    raw.on('error', (e) => this.emit('error', e));
    raw.on('close', () => { this.closed = true; clearTimeout(this.nriTimer); this.emit('close'); });
  }

  // Interface net.Socket utilisée par Avr
  setEncoding() {}
  setTimeout(ms) { this.raw.setTimeout?.(ms); }
  setKeepAlive() {}
  destroy(e) { clearTimeout(this.nriTimer); this.raw.destroy(e); }
  write(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.search(/[\r\n]/)) >= 0) {
      const cmd = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (cmd) this._fromPioneer(cmd);
    }
  }

  _ready() {
    if (this.ready || this.closed) return;
    this.ready = true; clearTimeout(this.nriTimer);
    this.emit('connect');
    this._out([MARKER]);
  }
  _tx(body) { if (!this.closed) { const f = frame(`!1${body}\r`); this.raw.write(typeof Buffer !== 'undefined' ? Buffer.from(f, 'latin1') : f); } }
  _out(lines) { if (lines.length) setTimeout(() => { if (!this.closed) this.emit('data', lines.map((l) => l + '\r\n').join('')); }, 0); }
  _zone(n) { return !this.info || !Object.keys(this.info.zones).length ? n === '1' || n === '2' : !!this.info.zones[n]; }

  // Entrées disponibles : celles de la fiche NRI pour la zone donnée (masque 01 principale, 02 zone 2, 04 zone 3)
  _inputs(zoneBit = 1) {
    const sel = this.info?.selectors?.length ? this.info.selectors : Object.keys(SLI_NAMES).filter((s) => !['24', '25', '00', '04', '05', '20', '27', '28', '2A', '2D', '2F', '30', '33', '55', '56', '57'].includes(s)).map((id) => ({ id, name: SLI_NAMES[id], zone: 7 }));
    const out = {};
    for (const s of sel) {
      const fn = SLI_TO_FN[s.id];
      if (fn && (s.zone & zoneBit) && !out[fn]) out[fn] = (s.id === '24' || s.id === '25') ? 'TUNER' : s.name || SLI_NAMES[s.id];
    }
    return out;
  }

  /* --- appli → ampli --- */
  _fromPioneer(c) {
    const tx = (...cmds) => cmds.forEach((x) => this._tx(x));
    const local = (...lines) => this._out(lines);
    const no = () => local('E04');
    let m;
    const QUERIES = {
      '?P': 'PWRQSTN', '?V': 'MVLQSTN', '?M': 'AMTQSTN', '?F': 'SLIQSTN', '?S': 'LMDQSTN', '?BA': 'TFRQSTN', '?TR': 'TFRQSTN',
      '?FR': 'TUNQSTN', '?PR': 'PRSQSTN',
      '?AP': this._zone('2') && 'ZPWQSTN', '?ZV': this._zone('2') && 'ZVLQSTN', '?Z2M': this._zone('2') && 'ZMTQSTN', '?ZS': this._zone('2') && 'SLZQSTN',
      '?ZGB': this._zone('2') && 'ZTNQSTN', '?ZGC': this._zone('2') && 'ZTNQSTN',
      '?BP': this._zone('3') && 'PW3QSTN', '?YV': this._zone('3') && 'VL3QSTN', '?Z3M': this._zone('3') && 'MT3QSTN', '?ZT': this._zone('3') && 'SL3QSTN',
    };
    if (c in QUERIES) return QUERIES[c] ? tx(QUERIES[c]) : no();
    switch (c) {
      case '?RGD': return local(`RGD<${this.info?.model || 'eISCP'}/eISCP>`);
      case '?SSI': return this.info?.firmware ? local(`SSI"${this.info.firmware}"`) : no();
      case '?SSO': return this.info?.name ? local(`SSO${this.info.name}`) : no();
      case '?TO': return local('TO1');            // pas d'interrupteur de tonalité en eISCP : toujours active
      case '?ZGA': return this._zone('2') ? local('ZGA1') : no();
      case '?FL': return local(`FL02${hexText(this.st.title || this.st.inputName || '')}`);
      case '?TQ': return local(...(this.info?.presets || []).filter((p) => p.n <= 45 && p.name).map((p) => { const pr = prsToPr(p.n); return `TQ${pr[0]}${+pr.slice(1)}"${p.name.replace(/"/g, "'").slice(0, 32)}"`; }));
      case 'PO': return tx('PWR01');
      case 'PF': return tx('PWR00');
      case 'MO': return tx('AMT01');
      case 'MF': return tx('AMT00');
      case 'VU': return tx('MVLUP');
      case 'VD': return tx('MVLDOWN');
      case 'APO': return tx('ZPW01');
      case 'APF': return tx('ZPW00');
      case 'Z2MO': return tx('ZMT01');
      case 'Z2MF': return tx('ZMT00');
      case 'ZU': return tx('ZVLUP');
      case 'ZD': return tx('ZVLDOWN');
      case 'BPO': return tx('PW301');
      case 'BPF': return tx('PW300');
      case 'Z3MO': return tx('MT301');
      case 'Z3MF': return tx('MT300');
      case 'YU': return tx('VL3UP');
      case 'YD': return tx('VL3DOWN');
      case 'BI': return tx('TFRBUP');     // BI/BD : graves +/−, TI/TD : aigus +/− (même sens que l'appli)
      case 'BD': return tx('TFRBDOWN');
      case 'TI': return tx('TFRTUP');
      case 'TD': return tx('TFRTDOWN');
      case 'TFI': return tx('TUNUP');
      case 'TFD': return tx('TUNDOWN');
      case 'TPI': return tx('PRSUP');
      case 'TPD': return tx('PRSDOWN');
      case '00TN': return tx('SLI24');
      case '01TN': return tx('SLI25');
      case 'TAC': return tx('TUNDIRECT');
      // Télécommande : navigation dans les menus de l'ampli
      case 'CUP': return tx('OSDUP');
      case 'CDN': return tx('OSDDOWN');
      case 'CLE': return tx('OSDLEFT');
      case 'CRI': return tx('OSDRIGHT');
      case 'CEN': return tx('OSDENTER');
      case 'CRT': return tx('OSDEXIT');
      case 'HM': return tx('OSDHOME');
      case '1TO': case '0TO': case '1ZGA': case '0ZGA': return local(c.endsWith('ZGA') ? 'ZGA1' : 'TO1');
      default: break;
    }
    if ((m = /^\?RGB(\d{2})$/.exec(c))) { const n = this._inputs()[m[1]]; return local(n ? `RGB${m[1]}0${n}` : 'E06'); }
    if ((m = /^(\d{3})VL$/.exec(c))) return tx(`MVL${volToMvl(+m[1])}`);
    if ((m = /^(\d{2})ZV$/.exec(c))) return tx(`ZVL${zoneToZvl(+m[1])}`);
    if ((m = /^(\d{2})YV$/.exec(c))) return tx(`VL3${zoneToZvl(+m[1])}`);
    if ((m = /^(\d{2})FN$/.exec(c))) return FN_TO_SLI[m[1]] ? tx(`SLI${FN_TO_SLI[m[1]]}`) : local('E06');
    if ((m = /^(\d{2})ZS$/.exec(c))) return FN_TO_SLI[m[1]] ? tx(`SLZ${FN_TO_SLI[m[1]]}`) : local('E06');
    if ((m = /^(\d{2})ZT$/.exec(c))) return FN_TO_SLI[m[1]] ? tx(`SL3${FN_TO_SLI[m[1]]}`) : local('E06');
    if ((m = /^(\d{4})SR$/.exec(c))) { const l = srToLmd(m[1]); return l ? tx(`LMD${l}`) : local('E06'); }
    if ((m = /^(\d{2})(BA|TR)$/.exec(c))) return tx(`TFR${m[2] === 'BA' ? 'B' : 'T'}${toneStr(clamp(6 - +m[1], -6, 6))}`);
    if ((m = /^(\d{2})(ZGB|ZGC)$/.exec(c))) return tx(`ZTN${m[2] === 'ZGB' ? 'B' : 'T'}${toneStr(clamp(6 - +m[1], -6, 6))}`);
    if ((m = /^([A-G])(\d{2})PR$/.exec(c))) return tx(`PRS${prToPrs(m[1], +m[2])}`);
    if ((m = /^(\d)TP$/.exec(c))) return tx(`TUN${m[1]}`);
    if ((m = /^(\d{2})(NW|IP|BT)$/.exec(c))) { const a = NTC[m[2]][+m[1]]; return a ? tx(`NTC${a}`) : no(); }
    return no();
  }

  /* --- ampli → appli --- */
  _rx(chunk) {
    for (const body of this.deframe(chunk)) {
      const code = body.slice(0, 3), v = body.slice(3);
      if (code === 'NRI') { try { this.info = parseNri(utf8(v)); } catch { /* fiche illisible : valeurs par défaut */ } this._ready(); continue; }
      if (!this.ready) continue;
      this._out(this._toPioneer(code, v));
    }
  }

  _toPioneer(code, v) {
    if (v === 'N/A') return ['E02'];   // commande indisponible pour l'instant (ou sur ce modèle)
    const b01 = (x) => (x === '01' ? '0' : '1');   // Pioneer : 0 = marche / sourdine active
    switch (code) {
      case 'PWR': return [`PWR${b01(v)}`];
      case 'AMT': return [`MUT${b01(v)}`];
      case 'MVL': return /^[0-9A-F]{2}$/.test(v) ? [`VOL${pad(mvlToVol(v), 3)}`] : [];
      case 'ZPW': return [`APR${b01(v)}`];
      case 'ZMT': return [`Z2MUT${b01(v)}`];
      case 'ZVL': return /^[0-9A-F]{2}$/.test(v) ? [`ZV${pad(zvlToZone(v), 2)}`] : [];
      case 'PW3': return [`BPR${b01(v)}`];
      case 'MT3': return [`Z3MUT${b01(v)}`];
      case 'VL3': return /^[0-9A-F]{2}$/.test(v) ? [`YV${pad(zvlToZone(v), 2)}`] : [];
      case 'SLI': case 'SLZ': case 'SL3': {
        const fn = SLI_TO_FN[v.toUpperCase()];
        if (!fn) return [];
        const out = [code === 'SLI' ? `FN${fn}` : code === 'SLZ' ? `Z2F${fn}` : `Z3F${fn}`];
        if (code === 'SLI') {
          this.st.inputName = this._inputs()[fn] || SLI_NAMES[v.toUpperCase()] || ''; this.st.title = null;
          out.push(`FL02${hexText(this.st.inputName)}`);
          if (fn === '02') this._tx('TUNQSTN');
        }
        return out;
      }
      case 'LMD': return /^[0-9A-F]{2}$/i.test(v) ? [`SR${lmdToSr(v)}`] : [];
      case 'TFR': case 'ZTN': {
        const m = /^B([+-][0-9A-F]|00)T([+-][0-9A-F]|00)$/i.exec(v);
        if (!m) return [];
        const c = (db) => pad(6 - clamp(db, -6, 6), 2);
        return code === 'TFR' ? [`BA${c(toneVal(m[1]))}`, `TR${c(toneVal(m[2]))}`] : [`ZGB${c(toneVal(m[1]))}`, `ZGC${c(toneVal(m[2]))}`];
      }
      case 'TUN': {
        if (!/^\d{5}$/.test(v)) return [];
        return [+v >= 2000 ? `FRF${v}` : `FRA${v}`];
      }
      case 'PRS': return /^[0-9A-F]{2}$/i.test(v) && parseInt(v, 16) > 0 ? [`PR${prsToPr(parseInt(v, 16))}`] : [];
      case 'NTI': { this.st.title = utf8(v); return [`FL02${hexText(this.st.title)}`]; }
      default: return [];
    }
  }
}

module.exports = { EISCP_PORT, MARKER, EiscpBridge, frame, createDeframer, parseNri, SLI_TO_FN, SLI_NAMES, lmdToSr, toLatin1, utf8 };
