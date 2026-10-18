'use strict';
const { EventEmitter } = require('node:events');
const { QUERIES, INPUT_NAME_QUERIES, TUNER_NAME_QUERY, SSC_ITEMS, newState, parseLine, applyEvent } = require('./protocol');


// Socket TCP par défaut (Node). L'application Android injecte un socket natif de même interface :
// setEncoding, setTimeout, write, destroy et les événements connect / data / timeout / error / close.
const { EiscpBridge, EISCP_PORT } = require('./eiscp');
const nodeSocket =(host, port) => require('node:net').createConnection({ host, port });

// Commandes qu'on peut renvoyer sans effet de bord (consigne de valeur "nnnXX", marche/arrêt, sourdine) ;
// pas les bascules ni les pas (VU, VD, MZ, 9xxx = « suivant »…).
const idempotent = (cmd) => (/^\d+[A-Z]+$/.test(cmd) && !/^9+[A-Z]/.test(cmd)) || /^[A-Z_]{3}\d{2}CLV$/.test(cmd) || /^(PO|PF|MO|MF|APO|APF|BPO|BPF|ZEO|ZEF|Z2MO|Z2MF|Z3MO|Z3MF|HZMO|HZMF)$/.test(cmd);
// Sans aucune réponse dans ce délai, une consigne est considérée comme perdue (ampli occupé à afficher un autre
// réglage : constaté sur un VSX-921, un niveau de canal envoyé juste après Dialog Enhancement était ignoré).
const LOST_MS = 1200;
// Un réglage audio (ATH, ATM…) ouvre sur l'ampli le menu des paramètres audio, annoncé par « APA » ; tant qu'il reste
// affiché (une dizaine de secondes), les niveaux de canal sont ignorés sans réponse (constaté sur un VSX-921).
const APA_MS = 10500, LEVEL_WRITE = /^([A-Z_]{3}\d{2}CLV|\d+ILV)$/;
// Début de la réponse quand elle ne reprend pas le code de la commande
const ECHO = { VL: 'VOL', PO: 'PWR', PF: 'PWR', MO: 'MUT', MF: 'MUT', Z2MO: 'Z2MUT', Z2MF: 'Z2MUT', Z3MO: 'Z3MUT', Z3MF: 'Z3MUT', HZMO: 'HZMUT', HZMF: 'HZMUT', APO: 'APR', APF: 'APR', BPO: 'BPR', BPF: 'BPR', ZEO: 'ZEP', ZEF: 'ZEP', ZS: 'Z2F', ZT: 'Z3F', ZEA: 'ZEA', FN: 'FN', SR: 'SR', TO: 'TO', BA: 'BA', TR: 'TR' };
const WATCH_MS = 15000, IDLE_MS = 60000;
const AFTER_POWER_ON = ['?V', '?M', '?F', '?S', '?AST', '?VST', '?FL', '?SPK', '?TO', '?BA', '?TR'];
const AFTER_INPUT = ['?S', '?AST', '?VST'];
// Modèles connus pour refuser le volume absolu (d'après aiopioneer) ; les autres sont détectés à la première erreur.
const STEP_ONLY_MODELS = /^VSX-(S510|528)\b/;
const VOLUME_STEPS = [
  { re: /^(\d{3})VL$/, up: 'VU', down: 'VD', path: 'volume', current: (s) => s.volume },
  { re: /^(\d{2})ZV$/, up: 'ZU', down: 'ZD', path: 'z2.volume', current: (s) => s.z2?.volume },
  { re: /^(\d{2})YV$/, up: 'YU', down: 'YD', path: 'z3.volume', current: (s) => s.z3?.volume },
  { re: /^(\d{2})HZV$/, up: 'HZU', down: 'HZD', path: 'hdz.volume', current: (s) => s.hdz?.volume },
];

class Avr extends EventEmitter {
  constructor({ createSocket = nodeSocket } = {}) {
    super();
    this.createSocket = createSocket;
    this.state = newState();
    this.host = null;
    this.port = 8102;
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.sock = null;
    this.queue = [];      // commandes de l'utilisateur (prioritaires)
    this.lowQueue = [];   // interrogations d'arrière-plan
    this.timer = null;
    this.retry = null;
    this.buf = '';
    this.wanted = false;
    this.syncTotal = 0;
    this.gapMs = 80;   // délai entre commandes (certains modèles exigent plus lent)
  }

  setStatus(s, extra) {
    this.status = s;
    this.emit('status', { status: s, host: this.host, port: this.port, retry: this.wanted, ...extra });
  }

  connect(host, port = 8102, proto = null) {
    this.disconnect();
    this.proto = proto;
    this.host = host; this.port = port; this.wanted = true; this.stepOnly = false; this.attempts = 0;
    this._open();
  }

  _open() {
    this.setStatus('connecting');
    // Pioneer récents (eISCP) : le pont traduit, le reste de l'appli ne voit que le protocole classique
    const sock = this.proto === 'eiscp' || this.port === EISCP_PORT ? new EiscpBridge(this.createSocket, this.host, this.port) : this.createSocket(this.host, this.port);
    this.sock = sock;
    sock.setEncoding('latin1');
    sock.setTimeout(15000);
    sock.on('connect', () => {
      sock.setTimeout(0);
      sock.setKeepAlive?.(true, 10000);
      this.attempts = 0; this.lastRx = Date.now(); this.probeAt = 0;
      clearInterval(this.watch);
      this.watch = setInterval(() => this._watchdog(), WATCH_MS);
      this.watch.unref?.();
      this.setStatus('connected');
      this.refresh();
    });
    sock.on('data', (d) => this._onData(d));
    sock.on('timeout', () => sock.destroy(new Error('timeout')));
    sock.on('error', (e) => { this.lastError = e.message; });
    sock.on('close', () => {
      if (this.sock !== sock) return;
      this.sock = null;
      clearInterval(this.watch); clearTimeout(this.followTimer); clearTimeout(this.recheckTimer); clearTimeout(this.holdTimer);
      this.queue = []; this.lowQueue = [];
      this.setStatus('disconnected', { error: this.lastError });
      // Reconnexion de plus en plus espacée (3 s, 6 s, 12 s… 30 s max) : l'ampli éteint au secteur ne sature pas le réseau
      const delay = Math.min(3000 * 2 ** (this.attempts || 0), 30000);
      this.attempts = (this.attempts || 0) + 1;
      if (this.wanted) this.retry = setTimeout(() => this._open(), delay);
    });
  }

  // Connexion muette depuis une minute (ampli débranché, Wi-Fi coupé…) : on interroge l'alimentation ; sans réponse
  // dans les 10 s, la connexion est considérée comme perdue et on se reconnecte.
  _watchdog() {
    if (!this.sock || this.status !== 'connected') return;
    const now = Date.now();
    if (this.probeAt && now - this.probeAt > 10000) { this.lastError = "l'ampli ne répond plus"; this.sock.destroy(); return; }
    if (!this.probeAt && now - this.lastRx > IDLE_MS) { this.probeAt = now; this.sock.write('?P\r'); }
  }

  // Interrogations de suivi, en arrière-plan, sans afficher la barre de synchronisation.
  _follow(cmds, delay) {
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => {
      if (!this.sock || this.status !== 'connected') return;
      if (!this.lowQueue.length) this.syncTotal = 0;
      for (const c of cmds) if (!this.lowQueue.includes(c)) this.lowQueue.push(c);
      this._pump();
    }, delay);
  }

  disconnect() {
    this.wanted = false;
    clearInterval(this.watch); clearTimeout(this.followTimer); clearTimeout(this.recheckTimer); clearTimeout(this.holdTimer);
    clearTimeout(this.retry); clearTimeout(this.timer);
    this.timer = null; this.queue = []; this.lowQueue = []; this.last = null;
    if (this.stepping) { clearTimeout(this.stepping.timer); this.stepping = null; }
    if (this.sock) { const s = this.sock; this.sock = null; s.destroy(); }
    this.state = newState();
    this.setStatus('disconnected');
  }

  _onData(d) {
    this.lastRx = Date.now(); this.probeAt = 0;
    this.buf += d;
    let i;
    while ((i = this.buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i).replace(/^(\r\n|\r|\n)/, '');
      if (!line) continue;
      this.emit('line', line);
      if (line === 'APA') this.apaAt = Date.now();
      if (this.expects?.length) { const err = /^(E\d\d|B00|R)$/.test(line); for (const x of this.expects) if (err || line.startsWith(x.prefix)) x.seen = true; }
      const ev = parseLine(line);
      if (!ev) continue;
      if (ev.path) {
        const before = ev.path === 'power' || ev.path === 'input' ? this.state[ev.path] : undefined;
        applyEvent(this.state, ev); this.emit('state', this.state);
        // À l'allumage l'ampli met quelques secondes à donner son état réel ; après un changement de source, le signal,
        // le mode d'écoute et la vidéo changent sans toujours être annoncés (comme aiopioneer, on les relit).
        if (ev.path === 'power' && ev.value === true && before === false) this._follow(AFTER_POWER_ON, 2500);
        // Niveau d'entrée de la nouvelle source (modèles récents ; les autres répondent E04, sans effet)
        if (ev.path === 'input' && ev.value !== before && this.sock) { const q = `?ILA${ev.value}`; if (!this.lowQueue.includes(q)) { if (!this.lowQueue.length) this.syncTotal = 0; this.lowQueue.push(q); this._pump(); } }
        if (ev.path === 'input' && before && ev.value !== before) this._follow(ev.value === '02' ? [...AFTER_INPUT, '?FR', '?PR'] : AFTER_INPUT, 1500);
        if (this.stepping && ev.path === this.stepping.v.path) this._step();
      }
      else {
        if (ev.error || ev.busy) this._onError(ev);
        this.emit('reply', ev);
      }
    }
  }

  // Réponse d'erreur : attribuée à la dernière commande écrite si elle vient de l'utilisateur et qu'elle est récente.
  // B00 (occupé) et E02 (indisponible pour l'instant, typique juste après la mise en marche) : on renvoie la commande
  // quelques fois si la renvoyer ne change rien (consigne de valeur, marche/arrêt) ; sinon l'erreur est signalée.
  _onError(ev) {
    const last = this.last;
    this.last = null;
    if (!last || !last.user || Date.now() - last.at > 1500) return;
    const code = ev.busy ? 'B00' : `E${ev.error}`;
    if ((code === 'B00' || code === 'E02') && idempotent(last.cmd) && last.tries < 4) {
      const tries = last.tries + 1;
      setTimeout(() => { if (this.sock && this.status === 'connected') { this.queue.unshift({ cmd: last.cmd, tries }); this._pump(); } }, 500 * tries);
      return;
    }
    // Volume en valeur absolue refusé : certains modèles (VSX-S510, VSX-528…) n'acceptent que +/− ; on bascule en pas à pas.
    const vol = VOLUME_STEPS.find((v) => v.re.test(last.cmd));
    if (vol && (code === 'E04' || code === 'E03') && !this.stepOnly) {
      this.stepOnly = true;
      this.emit('stepOnly', true);
      this.send(last.cmd);
      return;
    }
    this.emit('rejected', { cmd: last.cmd, code });
  }

  send(cmd, { low = false } = {}) {
    if (!this.sock || this.status !== 'connected') throw new Error('Non connecté');
    if (!low && this.isStepOnly()) {
      const v = VOLUME_STEPS.find((x) => x.re.test(cmd));
      if (v) { this._stepTo(v, +v.re.exec(cmd)[1]); return; }
    }
    if (low) this.lowQueue.push(cmd); else this.queue.push({ cmd, tries: 0 });
    this._pump();
  }

  isStepOnly() { return this.stepOnly || STEP_ONLY_MODELS.test(this.state.model || ''); }

  // Volume absolu sur un modèle qui ne connaît que +/− : un pas à la fois, chacun après l'écho du précédent (la taille
  // d'un pas varie selon les modèles). Arrêt à la cible, au dépassement, ou si l'ampli ne répond plus.
  _stepTo(v, target) {
    if (this.stepping) clearTimeout(this.stepping.timer);
    this.stepping = { v, target, n: 0, dir: 0 };
    this._step();
  }

  _step() {
    const st = this.stepping;
    if (!st) return;
    const cur = st.v.current(this.state);
    const dir = Math.sign(st.target - cur);
    if (!Number.isInteger(cur) || !dir || st.n >= 120 || (st.dir && dir !== st.dir)) { clearTimeout(st.timer); this.stepping = null; return; }
    st.dir = dir; st.n++;
    this.queue.push({ cmd: dir > 0 ? st.v.up : st.v.down, tries: 0 });
    this._pump();
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { if (this.stepping === st) this.stepping = null; }, 1500);
  }

  _pump() {
    if (this.timer || !(this.queue.length || this.lowQueue.length)) return;
    // Niveaux de canal en attente pendant que le menu des réglages audio est ouvert sur l'ampli (voir APA_MS)
    const held = (c) => LEVEL_WRITE.test(c) && Date.now() - (this.apaAt || 0) < APA_MS;
    let ui = this.queue.findIndex((q) => !held(q.cmd));
    if (ui < 0 && !this.lowQueue.length) {
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => this._pump(), APA_MS - (Date.now() - this.apaAt) + 50);
      return;
    }
    const fromLow = ui < 0;
    const item = fromLow ? { cmd: this.lowQueue.shift(), tries: 0 } : this.queue.splice(ui, 1)[0];
    if (fromLow) this.emit('sync', { remaining: this.lowQueue.length, total: this.syncTotal });
    if (fromLow && !this.lowQueue.length && this.refreshing) { this.refreshing = false; this._recheck(); }
    this.sock.write(item.cmd + '\r');
    this.last = { cmd: item.cmd, tries: item.tries, user: !fromLow, at: Date.now() };
    this.emit('sent', item.cmd);
    if (!fromLow && idempotent(item.cmd) && item.tries < 2) this._expectReply(item);
    // Après une commande de l'utilisateur, on laisse à l'ampli le temps de répondre avant de reprendre les interrogations :
    // une erreur éventuelle est ainsi attribuée à la bonne commande.
    const wait = !fromLow && !this.queue.length && this.lowQueue.length ? Math.max(this.gapMs, 250) : this.gapMs;
    this.timer = setTimeout(() => { this.timer = null; this._pump(); }, wait);
  }

  // Consigne de l'utilisateur sans réponse correspondante (écho ou erreur) : renvoyée, deux fois au plus.
  _expectReply(item) {
    const code = /^[A-Z_]{3}\d{2}(CLV)$/.exec(item.cmd)?.[1] || item.cmd.replace(/^\d+/, '');
    const prefix = ECHO[code] || code, key = item.cmd.replace(/\d+/g, '');
    const p = { prefix, seen: false };
    (this.expects ||= []).push(p);
    (this.lastByKey ||= {})[key] = item.cmd;
    setTimeout(() => {
      this.expects = this.expects.filter((x) => x !== p);
      // Pas de renvoi si une consigne plus récente du même réglage est partie entre-temps (curseur qu'on déplace)
      if (p.seen || this.lastByKey[key] !== item.cmd || !this.sock || this.status !== 'connected') return;
      this.queue.unshift({ cmd: item.cmd, tries: item.tries + 1 });
      this._pump();
    }, LOST_MS).unref?.();
  }

  // Interrogation complète : l'essentiel d'abord, puis noms d'entrées, mémoires tuner et réglages système.
  refresh() {
    const low = { low: true };
    this.syncTotal = this.lowQueue.length;
    for (const q of QUERIES) this.send(q, low);
    for (const q of INPUT_NAME_QUERIES) this.send(q, low);
    this.send(TUNER_NAME_QUERY, low);
    for (const i of SSC_ITEMS) this.send(`?SSC${i}`, low);
    this.syncTotal = this.lowQueue.length;
    this.refreshing = true; this.rechecks = 0;
    this.emit('sync', { remaining: this.syncTotal, total: this.syncTotal });
  }

  // Juste après la connexion (ampli qui sort de veille réseau), les premières questions restent parfois sans
  // réponse : constaté sur un VSX-921, marche/volume/entrée restaient inconnus. On les repose en fin de lecture.
  _recheck() {
    clearTimeout(this.recheckTimer);
    this.recheckTimer = setTimeout(() => {
      if (!this.sock || this.status !== 'connected' || this.rechecks >= 3) return;
      const s = this.state, miss = [];
      if (s.power == null) miss.push('?P');
      if (s.power && s.volume == null) miss.push('?V');
      if (s.power && s.mute == null) miss.push('?M');
      if (s.power && s.input == null) miss.push('?F');
      if (s.power && s.mode == null) miss.push('?S');
      if (!miss.length) return;
      this.rechecks++;
      if (!this.lowQueue.length) this.syncTotal = 0;
      for (const c of miss) if (!this.lowQueue.includes(c)) this.lowQueue.push(c);
      this.refreshing = true;
      this._pump();
    }, 1000);
    this.recheckTimer.unref?.();
  }
}

module.exports = { Avr };
