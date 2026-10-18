'use strict';
// Moteur de l'application : routes /api/*, sécurité et préréglages, indépendant du transport.
// Utilisé par server.js (HTTP + SSE) et par l'application Android (appels locaux dans la WebView).
// Aucune dépendance Node : tout ce qui touche au système (sockets, fichiers, démo) est injecté.
const { CMD, INPUTS, LISTENING_MODES, MODE_RULES, MEDIA_SOURCES, mediaCommand, PARAMS, VIDEO_HELP, GLOSSARY, CHANNELS, INPUT_CHANNELS, CHANNEL_NAMES, EQ_BANDS, EQ_RANGE, CLV_CODES } = require('./protocol');
const presetsCore = require('./presets-core');
const { DEMO_LIST } = require('./fake-device');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// store : { getConfig(), saveConfig(obj), loadPresets(), savePresets(list) }
// startDemo(profile) -> Promise<{ host, port, close() }> ; discoverFn / identifyFn : découverte réseau
function createEngine({ avr, store, discoverFn, identifyFn, startDemo = null }) {
  const listeners = new Set();
  const emit = (event, data) => { for (const fn of listeners) fn(event, data); };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  const cfg = () => store.getConfig() || {};
  const maxVolume = () => { const v = cfg().maxVolume; return Number.isInteger(v) ? v : 161; };
  const gap = () => { const v = cfg().commandDelay; return Number.isInteger(v) ? clamp(v, 30, 500) : 80; };
  const volumeScale = () => ({ max: 185, zero: 161, step: 0.5, ...(cfg().volumeScale || {}) });
  avr.gapMs = gap();

  let soloBackup = null;
  let demo = null, demoProfile = null;   // faux récepteur interne (mode démo) et son profil
  const stopDemo = async () => { if (!demo) return; const d = demo; demo = null; demoProfile = null; avr.disconnect(); avr.gapMs = gap(); await d.close(); };

  // L'état est poussé par paquets (~15/s max) : l'interrogation initiale produit une centaine de lignes.
  let stateTimer = null;
  avr.on('state', () => {
    if (stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; emit('state', avr.state); }, 60);
  });
  avr.on('status', (s) => emit('status', { ...s, demo: !!demo, demoProfile }));
  let lastSync = 0;
  avr.on('sync', (p) => { if (p.remaining === 0 || Date.now() - lastSync > 150) { lastSync = Date.now(); emit('sync', p); } });
  avr.on('line', (l) => emit('log', { dir: 'rx', text: l }));
  avr.on('sent', (l) => emit('log', { dir: 'tx', text: l }));
  avr.on('rejected', (r) => emit('rejected', r));
  avr.on('stepOnly', () => emit('log', { dir: 'info', text: 'Volume absolu refusé : passage au réglage pas à pas (VU/VD)' }));

  const snapshot = () => ({
    status: avr.status, host: avr.host, port: avr.port, demo: !!demo, demoProfile, demoProfiles: DEMO_LIST, state: avr.state,
    inputs: INPUTS, modes: LISTENING_MODES, modeRules: MODE_RULES, mediaSources: MEDIA_SOURCES, params: PARAMS, videoHelp: VIDEO_HELP, glossary: GLOSSARY, channels: CHANNELS, channelNames: CHANNEL_NAMES,
    inputChannels: INPUT_CHANNELS, eqBands: EQ_BANDS, eqRange: EQ_RANGE, maxVolume: maxVolume(), zoneMaxVolume: zoneMax(), volumeScale: volumeScale(), commandDelay: gap(),
    presets: store.loadPresets(),
  });

  // Écrit un vecteur de niveaux de canaux selon la famille de commande de l'ampli (ILV d'un bloc, ou CLV canal par canal).
  // En mode CLV on ne renvoie que les canaux modifiés ; la référence est la dernière consigne envoyée (les échos de l'ampli
  // arrivent avec retard, les comparer à un état incomplet ferait sauter des canaux).
  let levelsTarget = null, levelsTargetAt = 0;
  const sendLevelVector = (vals) => {
    if (avr.state.levelsMode === 'CLV') {
      const base = levelsTarget && Date.now() - levelsTargetAt < 4000 ? levelsTarget : (avr.state.levels || []);
      vals.forEach((u, i) => { if (CHANNELS[i] && CLV_CODES[CHANNELS[i]] && base[i] !== u) avr.send(CMD.clvSet(CHANNELS[i], clamp(u, 26, 74))); });
      levelsTarget = [...vals]; levelsTargetAt = Date.now();
    } else avr.send(CMD.levelsSet(vals));
  };

  const ok = (b = { ok: true }) => ({ status: 200, body: b });
  const fail = (status, error) => ({ status, body: { error } });
  const volumeError = () => fail(400, `Volume limité à ${maxVolume()} (réglage de sécurité)`);
  // Zones 2, 3 et HDZone : 0..81 avec 81 = 0 dB et 1 dB par pas ; même plafond en dB que la zone principale.
  const zoneMax = () => Math.max(0, Math.min(81, 81 - Math.ceil((161 - maxVolume()) / 2)));
  const zoneVolumeError = () => fail(400, `Volume de zone limité à ${zoneMax()} (réglage de sécurité)`);
  const ZONE_VOL = /^(\d{2})(ZV|YV|HZV)$/;

  // Traite une requête de l'API. Retourne { status, body } ; ne lève jamais (sauf 'Non connecté' converti en 409).
  async function handle(method, pathname, b = {}) {
    const post = method === 'POST';
    try {
      if (method === 'GET' && pathname === '/api/state') return ok(snapshot());

      if (post && pathname === '/api/discover') {
        emit('discovering', true);
        try {
          const found = await discoverFn({ onProgress: (p) => emit('progress', p) });
          return ok({ found });
        } finally { emit('discovering', false); }
      }
      if (post && pathname === '/api/demo') {
        const { on, profile } = b;
        if (on === false) { await stopDemo(); return ok(); }
        // Un autre profil pendant la démo : on remplace le récepteur simulé (changement de modèle à chaud)
        const want = DEMO_LIST[profile] ? profile : 'fy11';
        if (demo && demoProfile !== want) await stopDemo();
        if (!demo) {
          if (!startDemo) return fail(501, 'Mode démo indisponible');
          demo = await startDemo(want); demoProfile = want;
          avr.gapMs = 10;   // récepteur simulé : pas besoin d'espacer les commandes, la lecture initiale est quasi immédiate
          avr.connect(demo.host, demo.port, demo.proto);
        }
        return ok();
      }
      if (post && pathname === '/api/connect') {
        const { host, port } = b;
        if (!host || !/^[\w.\-:]+$/.test(host)) return fail(400, 'IP/hôte invalide');
        let target = Number(port) || null;
        if (!target) {
          emit('progress', { phase: 'identify', message: `Recherche du port de contrôle de ${host} (23, 8102)…` });
          const dev = await identifyFn(host);
          if (!dev) return fail(502, `${host} ne répond pas comme un récepteur Pioneer (ports 23 et 8102 testés)`);
          target = dev.port;
        }
        // Port 60128 = Pioneer récent (eISCP) : traduit par lib/eiscp.js
        const proto = target === 60128 || b.proto === 'eiscp' ? 'eiscp' : null;
        await stopDemo();
        avr.connect(host, target, proto);
        store.saveConfig({ ...cfg(), host, port: target, proto });
        return ok();
      }
      if (post && pathname === '/api/disconnect') {
        await stopDemo();
        avr.disconnect();
        const c = { ...cfg() }; delete c.host; delete c.port;
        store.saveConfig(c);
        return ok();
      }

      if (post && pathname === '/api/send') {
        const { cmd } = b;
        if (typeof cmd !== 'string' || !/^[\x20-\x7e]{1,60}$/.test(cmd)) return fail(400, 'Commande invalide');
        const vm = /^(\d{3})VL$/.exec(cmd);
        if (vm && +vm[1] > maxVolume()) return volumeError();
        const zm = ZONE_VOL.exec(cmd);
        if (zm && +zm[1] > zoneMax()) return zoneVolumeError();
        avr.send(cmd);
        return ok();
      }
      // Diagnostic complet : relit tout l'état (questions ?XXX uniquement, aucun réglage modifié)
      if (post && pathname === '/api/refresh') {
        if (avr.status !== 'connected') return fail(409, 'Non connecté');
        avr.refresh();
        return ok();
      }
      if (post && pathname === '/api/cmd') {
        const { name, arg } = b;
        const c = CMD[name];
        if (c === undefined) return fail(400, `Commande inconnue : ${name}`);
        if (name === 'volumeSet' && !(Number(arg) <= maxVolume())) return volumeError();
        if (['z2VolSet', 'z3VolSet', 'hdzVolSet'].includes(name) && !(Number(arg) <= zoneMax())) return zoneVolumeError();
        if (name === 'inputLevelSet' && !(Array.isArray(arg) && /^\d{2}$/.test(arg[0]) && Number.isInteger(arg[1]))) return fail(400, 'Niveau d\'entrée invalide');
        avr.send(typeof c === 'function' ? c(arg) : c);
        return ok();
      }
      if (post && pathname === '/api/set') {
        // Paramètre simple (PQ, IS, VSB, VHT, ATA, MC, SPK) ou réglage système SSC "ccvvvv".
        const { code, value, confirm } = b;
        if (PARAMS[code]?.readOnly) return fail(400, `${PARAMS[code].label} : lecture seule`);
        if (PARAMS[code]?.risky && confirm !== true) return fail(409, `${PARAMS[code].label} : confirmation requise (réglage d'installation)`);
        if (code === 'SSC') {
          if (!/^\d{6}$/.test(String(value))) return fail(400, 'Valeur SSC invalide');
          avr.send(`${value}SSC`); avr.send(`?SSC${String(value).slice(0, 4)}`);
        } else if (PARAMS[code]) {
          if (!/^\d{1,3}$/.test(String(value))) return fail(400, 'Valeur invalide');
          const wide = PARAMS[code].wide && avr.state.wide?.[code];
          if (wide && !PARAMS[code].wide[+value]) return fail(400, 'Valeur invalide');
          avr.send(wide ? `${PARAMS[code].wide[+value]}${code}` : `${String(value).padStart(PARAMS[code].width, '0')}${code}`);
          if (!PARAMS[code].writeOnly) avr.send(`?${code}`);
        } else if (/^VT[B-T]$/.test(code)) {
          if (!/^\d{1,2}$/.test(String(value))) return fail(400, 'Valeur invalide');
          avr.send(`${value}${code}`); avr.send(`?${code}`);
        } else return fail(400, `Paramètre inconnu : ${code}`);
        return ok();
      }
      if (post && (pathname === '/api/levels' || pathname === '/api/eq')) {
        const { values } = b;
        const isLevels = pathname === '/api/levels';
        const n = (isLevels ? avr.state.levels?.length : avr.state.eq?.length) || (isLevels ? 17 : 11);
        if (!Array.isArray(values) || values.length !== n || values.some((v) => !Number.isFinite(v))) return fail(400, `${n} valeurs attendues`);
        const v = values.map((x) => clamp(Math.round(x), 0, 100));
        if (isLevels) sendLevelVector(v); else avr.send(CMD.eqSet(v));
        return ok();
      }
      if (post && pathname === '/api/solo') {
        // Met un canal en avant (les autres au minimum) ; { restore: true } rétablit les niveaux d'origine.
        const { index, restore } = b;
        if (restore) {
          if (soloBackup) { sendLevelVector(soloBackup); soloBackup = null; }
          return ok();
        }
        if (!avr.state.levels || !Number.isInteger(index) || index < 0 || index >= avr.state.levels.length) return fail(400, 'Canal invalide ou niveaux inconnus');
        if (!soloBackup) soloBackup = [...avr.state.levels];
        sendLevelVector(soloBackup.map((v, i) => (i === index ? Math.max(v, 50) : 26)));
        return ok();
      }

      if (method === 'GET' && pathname === '/api/presets') return ok(store.loadPresets());
      if (post && pathname === '/api/presets') {
        const { name, fields, data, id } = b;
        if (typeof name !== 'string' || !name.trim() || name.length > 40) return fail(400, 'Nom invalide');
        const list = store.loadPresets();
        const d = data || presetsCore.captureFromState(avr.state, Array.isArray(fields) ? fields : presetsCore.FIELDS);
        const existing = id && list.find((p) => p.id === id);
        if (existing) { existing.name = name.trim(); if (data || fields) existing.data = d; }
        else list.push({ id: presetsCore.newId(), name: name.trim(), data: d });
        store.savePresets(list);
        emit('presets', list);
        return ok({ presets: list });
      }
      if (post && pathname === '/api/presets/import') {
        // Restauration d'une sauvegarde : un preset de même nom est remplacé, les autres sont ajoutés.
        const { presets: incoming } = b;
        if (!Array.isArray(incoming) || incoming.length > 200) return fail(400, 'Liste de presets invalide');
        const valid = incoming.filter((p) => p && typeof p.name === 'string' && p.name.trim() && p.name.length <= 40 && p.data && typeof p.data === 'object' && !Array.isArray(p.data) && presetsCore.sanitizeData(p.data));
        if (valid.length !== incoming.length) return fail(400, 'Sauvegarde invalide : preset mal formé');
        const list = store.loadPresets();
        for (const p of valid) {
          const name = p.name.trim(), i = list.findIndex((x) => x.name === name);
          const entry = { id: i >= 0 ? list[i].id : presetsCore.newId(), name, data: presetsCore.sanitizeData(p.data) };
          if (i >= 0) list[i] = entry; else list.push(entry);
        }
        store.savePresets(list); emit('presets', list);
        return ok({ presets: list, imported: valid.length });
      }
      if (method === 'DELETE' && pathname.startsWith('/api/presets/')) {
        const id = decodeURIComponent(pathname.split('/').pop());
        const list = store.loadPresets().filter((p) => p.id !== id);
        store.savePresets(list); emit('presets', list);
        return ok({ presets: list });
      }
      if (post && /^\/api\/presets\/[^/]+\/apply$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split('/')[3]);
        const p = store.loadPresets().find((x) => x.id === id);
        if (!p) return fail(404, 'Preset introuvable');
        const cmds = presetsCore.buildCommands(p.data, { maxVolume: maxVolume(), levelsMode: avr.state.levelsMode || 'ILV', currentLevels: avr.state.levels, wide: avr.state.wide });
        for (const c of cmds) avr.send(c);
        avr.send('?FL');
        return ok({ ok: true, sent: cmds });
      }
      if (post && pathname === '/api/key') {
        const { name } = b;
        if (typeof name !== 'string' || !name.startsWith('key') || typeof CMD[name] !== 'string') return fail(400, `Touche inconnue : ${name}`);
        avr.send(CMD[name]);
        return ok();
      }
      if (post && pathname === '/api/media') {
        // Lecture sur la source réseau / iPod-USB / Bluetooth en cours : la famille de commande dépend de la source.
        const c = mediaCommand(avr.state.input, b.action);
        if (!c) return fail(400, 'Pas de commande de lecture pour cette source');
        avr.send(c);
        return ok();
      }
      if (post && pathname === '/api/rename') {
        const { id, name, reset } = b;
        if (!/^\d{2}$/.test(String(id))) return fail(400, "Identifiant d'entrée invalide");
        if (reset) avr.send(CMD.inputRenameReset(id));
        else {
          if (typeof name !== 'string' || !/^[\x20-\x7e]{1,14}$/.test(name)) return fail(400, 'Nom invalide (1 à 14 caractères ASCII)');
          avr.send(CMD.inputRename(id, name));
        }
        avr.send(`?RGB${id}`);
        return ok();
      }
      if (post && pathname === '/api/tune') {
        // Saisie directe d'une fréquence : bande, touche d'accès direct, puis les chiffres (essai : dépend du modèle).
        const { freq, band } = b;
        const f = Number(freq);
        if (!(f > 0) || !['FM', 'AM'].includes(band)) return fail(400, 'Fréquence ou bande invalide');
        if (band === 'FM' && !(f >= 76 && f <= 108)) return fail(400, 'FM : 76 à 108 MHz');
        if (band === 'AM' && !(f >= 500 && f <= 1710)) return fail(400, 'AM : 500 à 1710 kHz');
        // Pas AM connu (?SUQ) : 9 kHz (531, 540…) ou 10 kHz (530, 540…)
        const step = avr.state.tuner.amStep;
        if (band === 'AM' && step && (Math.round(f) - (step === 9 ? 531 : 530)) % step !== 0) return fail(400, `AM : la fréquence doit suivre le pas de ${step} kHz`);
        avr.send(band === 'FM' ? CMD.tunerBandFm : CMD.tunerBandAm);
        avr.send(CMD.tunerDirect);
        for (const d of String(band === 'FM' ? Math.round(f * 100) : Math.round(f))) avr.send(CMD.tunerDigit(d));
        avr.send('?FR');
        return ok();
      }
      if (post && pathname === '/api/config') {
        const next = {};
        if (b.maxVolume !== undefined) {
          if (!Number.isInteger(b.maxVolume) || b.maxVolume < 0 || b.maxVolume > 185) return fail(400, 'maxVolume doit être entre 0 et 185');
          next.maxVolume = b.maxVolume;
        }
        if (b.commandDelay !== undefined) {
          if (!Number.isInteger(b.commandDelay) || b.commandDelay < 30 || b.commandDelay > 500) return fail(400, 'commandDelay doit être entre 30 et 500 ms');
          next.commandDelay = b.commandDelay; if (!demo) avr.gapMs = b.commandDelay;
        }
        if (b.volumeScale !== undefined) {
          const v = b.volumeScale || {};
          if (![v.max, v.zero].every((x) => Number.isInteger(x) && x >= 1 && x <= 999) || !(v.step > 0 && v.step <= 5)) return fail(400, "Échelle de volume invalide (max, zéro, pas)");
          next.volumeScale = { max: v.max, zero: v.zero, step: v.step };
        }
        if (!Object.keys(next).length) return fail(400, 'Aucun réglage à enregistrer');
        store.saveConfig({ ...cfg(), ...next });
        emit('config', { maxVolume: maxVolume(), zoneMaxVolume: zoneMax(), volumeScale: volumeScale(), commandDelay: gap() });
        return ok();
      }
      return fail(404, 'Not found');
    } catch (e) {
      return fail(e.message === 'Non connecté' ? 409 : 500, e.message);
    }
  }

  return { handle, snapshot, subscribe, emit, stopDemo, isDemo: () => !!demo };
}

module.exports = { createEngine };
