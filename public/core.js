'use strict';
// Noyau : DOM helpers, API, état partagé, routeur de vues, SSE.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('pr:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pr:' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

function h(tag, props, ...kids) {
  const el = tag === 'svg' || props?.ns ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'ns' || v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const S = (tag, props, ...kids) => h(tag, { ns: true, ...props }, ...kids);

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  speaker: '<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="14.5" r="3.5"/><circle cx="12" cy="7" r="1"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  zone: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l10-5"/><circle cx="16" cy="14" r="2.5"/><path d="M6 12h4M6 16h4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  power: '<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 6 2.3"/>',
  usb: '<path d="M12 3v14"/><circle cx="12" cy="19" r="2"/><path d="M12 8l-4 3v3M12 11l4-2v3"/><rect x="6.5" y="13.5" width="3" height="3"/><circle cx="16" cy="7.5" r="1.5"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  dpad: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v2.5M12 15v2.5M6.5 12H9M15 12h2.5"/><circle cx="12" cy="12" r="1.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.7M12 17h.01"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

const App = {
  state: null, status: 'disconnected', host: null, current: 'home', views: {}, order: [],
  meta: { inputs: {}, modes: {}, params: {}, channels: [], channelNames: {}, eqBands: [], maxVolume: 161, presets: [] },
  learned: store.get('learnedModes', {}), pendingLearn: null, handlers: {},

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); },
  emit(ev, data) { for (const fn of this.handlers[ev] || []) fn(data); },

  toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(this._tt); this._tt = setTimeout(() => (t.className = ''), err ? 4500 : 2200);
  },
  // Erreurs venant de l'ampli ou du réseau : gardées dans le journal (icône ⚠ de l'en-tête).
  // Les mineures (réglage refusé…) restent silencieuses ; les graves s'affichent aussi tout de suite.
  journal: Diag.createJournal({ load: () => store.get('journal', []), save: (l) => store.set('journal', l) }),
  problem(e) {
    this.journal.add(e);
    if (e.sev === 'major') this.toast(e.title, true);
  },

  async api(path, body, method = 'POST') {
    try {
      const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    } catch (e) { this.problem({ sev: 'major', title: e.message, raw: path }); throw e; }
  },
  cmd(name, arg) { return this.api('/api/cmd', { name, arg }).catch(() => {}); },
  set(code, value, confirm = false) { return this.api('/api/set', { code, value: String(value), confirm }).catch(() => {}); },
  send(cmd) { return this.api('/api/send', { cmd }).catch(() => {}); },

  // --- capacités : ce que l'ampli a réellement répondu pendant la lecture initiale
  caps(s = this.state) {
    if (!s) return {};
    const has = (g) => Object.entries(this.meta.params).some(([c, d]) => d.group === g && s.params[c] !== undefined);
    return {
      zone2: s.z2.power !== null, zone3: s.z3.power !== null, hdzone: s.hdz?.power != null, zone2Tone: s.z2.tone !== null, tuner: s.tuner.freq !== null,
      levels: !!s.levels, eq: !!s.eq, video: Object.keys(s.video).length > 0, tone: s.tone !== null,
      installation: has('installation') || has('hdmi') || has('gestion') || Object.keys(s.speakerSetup || {}).length > 0,
      speakers: !!s.levels || !!s.audio,
    };
  },
  // Entrées masquées par l'utilisateur (n'affecte pas l'ampli)
  hiddenInputs() { return store.get('hiddenInputs', []) || []; },

  // --- noms
  inputIds() {
    const names = this.state?.names || {};
    const hidden = new Set(this.hiddenInputs());
    const ids = Object.keys(names).filter((k) => names[k] && !hidden.has(k));
    return (ids.length ? ids : Object.keys(this.meta.inputs)).sort();
  },
  inputName(id) { return this.state?.names?.[id] || this.meta.inputs[id] || (id ? `Entrée ${id}` : '—'); },
  modeName(id) { return this.modelModes().names?.[id] || this.meta.modes[id] || this.learned[id] || (id ? `Mode ${id}` : '—'); },
  // Règles de modes propres au modèle connecté (noms différents, liste restreinte ou modes absents).
  modelModes() {
    const m = this.state?.model || '';
    return (m && (this.meta.modeRules?.models || []).find((r) => new RegExp(r.re).test(m))) || {};
  },
  // Modes proposés : sans ceux que le modèle n'a pas (le mode en cours reste toujours visible).
  modeIds(s = this.state) {
    // Ampli eISCP : ses propres codes (5000+) ; ampli classique : sans ceux-là
    const eiscp = s?.protocol === 'eiscp', R = this.meta.modeRules || {};
    const r = this.modelModes(), ids = new Set(eiscp ? R.eiscp || [] : r.only || Object.keys(this.meta.modes).filter((id) => +id < 5000));
    for (const id of r.off || []) ids.delete(id);
    if (s?.mode) ids.add(s.mode);
    return [...ids].sort();
  },
  // Mode réservé aux sources stéréo alors que la source est multicanal (ou l'inverse) : false. null si inconnu.
  modeFitsSignal(id, s = this.state) {
    const inp = s?.audio?.input;
    if (!inp || !inp.some(Boolean)) return null;
    const multi = inp[0] && inp[1] && inp[2];   // avant G, centre, avant D présents
    const R = this.meta.modeRules || {};
    if (multi && R.twoCh?.includes(id)) return false;
    if (!multi && R.multi?.includes(id)) return false;
    return true;
  },
  noteModeChange(id) { this.pendingLearn = { id, until: Date.now() + 3500 }; },
  volScale() { return { max: 185, zero: 161, step: 0.5, ...(this.meta.volumeScale || {}) }; },
  volDb(v) { if (v == null) return null; const sc = this.volScale(); return (v - sc.zero) * sc.step; },
  volText(v) { const d = this.volDb(v); return d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`; },

  // --- vues
  register(id, view) { this.views[id] = view; this.order.push(id); },
  show(id) {
    if (!this.views[id]) return;
    this.current = id; store.set('view', id);
    for (const [k, v] of Object.entries(this.views)) v.el.classList.toggle('active', k === id);
    $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
    this.views[id].onShow?.();
    this.render();
    window.scrollTo({ top: 0 });
  },
  render() {
    if (this._raf) return;
    this._raf = true;
    // requestAnimationFrame est suspendu dans un onglet masqué : la minuterie sert de repli.
    const run = () => {
      if (!this._raf) return;
      this._raf = false;
      this.renderTop();
      const v = this.views[this.current];
      if (v && this.state) v.update?.(this.state);
    };
    requestAnimationFrame(run); setTimeout(run, 120);
  },
  renderTop() {
    const s = this.state, on = this.status === 'connected';
    $('#dot').className = 'dot ' + (on ? 'on' : this.status === 'connecting' ? 'wait' : '');
    $('#deviceName').textContent = s?.friendlyName || (s?.model ? `Pioneer ${s.model}` : 'Pioneer');
    $('#deviceSub').textContent = !on ? (this.status === 'connecting' ? 'Connexion…' : 'Non connecté')
      : s?.power === false ? 'En veille' : `${this.inputName(s?.input)} · ${this.modeName(s?.mode)}`;
    if (on && this.host) $('#deviceSub').title = `${this.host}${s?.firmware ? ' · v' + s.firmware : ''}`;
    for (const [id, v] of Object.entries(this.views)) if (v.available) { const ok = !s || v.available(s); $$(`.navbtn[data-view=${id}]`).forEach((b) => { b.hidden = !ok; }); }
    const p = $('#topPower'), m = $('#topMute');
    p.classList.toggle('on', !!s?.power); m.classList.toggle('on', !!s?.mute);
    p.disabled = m.disabled = !on;
    $('#navHost').textContent = this.host ? `${this.host}` : '';
  },
};

// Applique un nouvel état + apprentissage des noms de modes d'écoute (l'afficheur montre le nom après un changement).
function onState(s) {
  const prev = App.state;
  App.state = s;
  const pl = App.pendingLearn;
  if (pl && Date.now() < pl.until && s.display && prev && s.display !== prev.display && s.mode === pl.id && /[A-Za-z]{3}/.test(s.display) && !/NOT AVAILABLE|VOL|MUTE/i.test(s.display)) {
    App.learned[pl.id] = s.display; store.set('learnedModes', App.learned); App.pendingLearn = null;
  }
  if (prev && s.display !== prev.display && /NOT AVAILABLE/i.test(s.display) && Date.now() - (App.lastWrite || 0) < 2500) {
    App.problem({ title: "Réglage indisponible dans le mode d'écoute ou la source actuels", advice: "Change de mode d'écoute ou de source, puis réessaie.", raw: `afficheur : ${s.display}` });
  }
  App.render();
}

function connectSSE() {
  const es = new EventSource('/events');
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    Object.assign(App.meta, { inputs: d.inputs, modes: d.modes, modeRules: d.modeRules, mediaSources: d.mediaSources || {}, params: d.params, channels: d.channels, inputChannels: d.inputChannels, channelNames: d.channelNames, eqBands: d.eqBands, eqRange: d.eqRange, maxVolume: d.maxVolume, zoneMaxVolume: d.zoneMaxVolume ?? 81, volumeScale: d.volumeScale, commandDelay: d.commandDelay, presets: d.presets, videoHelp: d.videoHelp, glossary: d.glossary });
    App.status = d.status; App.host = d.host; App.port = d.port; App.demo = !!d.demo; App.demoProfile = d.demoProfile; App.demoProfiles = d.demoProfiles || App.demoProfiles; App.state = d.state;
    App.emit('meta'); App.emit('status', d); App.render();
  });
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('status', (e) => { const d = JSON.parse(e.data); App.status = d.status; App.host = d.host; App.port = d.port; App.demo = !!d.demo; App.demoProfile = d.demoProfile; App.emit('status', d); App.render(); });
  es.addEventListener('progress', (e) => App.emit('progress', JSON.parse(e.data)));
  es.addEventListener('discovering', (e) => App.emit('discovering', JSON.parse(e.data)));
  es.addEventListener('sync', (e) => App.emit('sync', JSON.parse(e.data)));
  es.addEventListener('presets', (e) => { App.meta.presets = JSON.parse(e.data); App.emit('presets'); App.render(); });
  es.addEventListener('config', (e) => { Object.assign(App.meta, JSON.parse(e.data)); App.emit('config'); App.render(); });
  es.addEventListener('log', (e) => App.emit('log', JSON.parse(e.data)));
  es.addEventListener('rejected', (e) => {
    const r = JSON.parse(e.data);
    const code2 = /^\d+([A-Z]+)$/.exec(r.cmd)?.[1], def = App.meta.params?.[code2];
    if (def) (App.rejected ||= {})[code2] = Date.now();
    App.problem(Diag.rejectedEntry(r, def?.label));
  });
  es.onerror = () => { App.status = 'disconnected'; App.emit('status', { status: 'disconnected', error: 'serveur local injoignable' }); App.render(); };
}

function throttle(fn, ms) {
  let last = 0, timer = null, pending;
  return (...args) => {
    pending = args;
    const run = () => { last = Date.now(); timer = null; fn(...pending); };
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run(); else if (!timer) timer = setTimeout(run, wait);
  };
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
// Bouton « i » qui déplie une explication sous le libellé d'un réglage.
function InfoToggle(text) {
  const box = h('div', { class: 'info-box', text, hidden: true });
  const btn = h('button', { class: 'info-btn', type: 'button', 'aria-label': 'Aide', title: 'Aide', text: 'i', onclick: (e) => { e.stopPropagation(); box.hidden = !box.hidden; btn.classList.toggle('on', !box.hidden); } });
  return { btn, box };
}

// Sélecteur de langue (Réglages, écran de connexion, bandeau démo) : tous restent synchronisés.
function LangSelect(props = {}) {
  const sel = h('select', { 'aria-label': 'Langue / Language', title: 'Langue / Language', ...props, onchange: () => I18N.set(sel.value) },
    Object.entries(I18N.LANGS).map(([c, n]) => h('option', { value: c, text: n })));
  sel.value = I18N.lang;
  window.addEventListener('langchange', () => { sel.value = I18N.lang; });
  return sel;
}
// Sélecteur du modèle simulé : en démo, change de récepteur à chaud ; sinon choisit celui à lancer.
function DemoModelSelect(props = {}) {
  const sel = h('select', { 'aria-label': 'Modèle simulé', title: 'Modèle simulé', ...props });
  const fill = () => {
    const list = App.demoProfiles || {};
    if (sel.options.length !== Object.keys(list).length) { sel.innerHTML = ''; for (const [id, p] of Object.entries(list)) sel.add(new Option(p.label, id)); }
    sel.value = App.demoProfile || store.get('demoProfile', 'fy11');
  };
  sel.addEventListener('change', () => { store.set('demoProfile', sel.value); if (App.demo) App.api('/api/demo', { on: true, profile: sel.value }).then(() => App.toast('Modèle simulé changé')).catch(() => {}); });
  App.on('meta', fill); App.on('status', fill); fill();
  return sel;
}

function rangeFill(input) { const p = ((input.value - input.min) / (input.max - input.min)) * 100; input.style.setProperty('--p', p + '%'); }

function confirmDialog(title, text) {
  return new Promise((resolve) => {
    const d = $('#dlg');
    d.innerHTML = '';
    const done = (v) => { d.onclose = null; d.close(); resolve(v); };
    d.append(h('h3', { text: title }), h('p', { class: 'muted', text: text }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Annuler', onclick: () => done(false) }),
        h('button', { class: 'btn primary', text: 'Confirmer', onclick: () => done(true) })));
    d.onclose = () => resolve(false);
    d.showModal();
  });
}

/* ---------- Réglage générique d'un paramètre du récepteur (bool / liste / plage) ---------- */
function paramFromCode(def, code) { return (code - (def.codeOffset || 0)) * (def.codeStep || 1); }
function paramToCode(def, v) { return Math.round(v / (def.codeStep || 1)) + (def.codeOffset || 0); }
function fmtParamValue(def, v, code) {
  if (def.autoCodes && def.autoCodes.includes(code)) return 'Auto';
  const dec = (def.step || 1) < 1 ? 1 : 0;
  const t = v.toFixed(dec);
  return `${def.min < 0 && v > 0 ? '+' : ''}${t}${def.unit ? ' ' + def.unit : ''}`;
}

function ParamRow(code, { compact = false } = {}) {
  const def = App.meta.params[code];
  const row = h('div', { class: 'param' });
  const info = def.help ? InfoToggle(def.help.startsWith(`${def.label} : `) ? def.help.slice(def.label.length + 3) : def.help) : null;
  const label = h('div', {}, def.label, info?.btn, def.risky ? h('span', { class: 'badge warn', style: 'margin-left:8px', text: 'installation' }) : null,
    def.hint && !compact ? h('small', { text: def.hint }) : null);
  row.append(label); if (info) row.append(info.box);
  let setUI = () => {}, dragging = false, lastRaw;
  // Écriture : les réglages d'installation demandent une confirmation (et reviennent à leur valeur si on annule).
  const write = async (value, revert) => {
    if (def.risky) {
      const ok = await confirmDialog(`Modifier « ${def.label} » ?`, "Ce réglage touche à la configuration de l'ampli ou de la salle. Assure-toi de savoir ce que tu fais ; tu pourras le remettre à sa valeur d'origine.");
      if (!ok) { revert?.(); if (lastRaw !== undefined) setUI(lastRaw); return; }
    }
    App.set(code, value, !!def.risky);
  };
  const readBadge = (text) => h('span', { class: 'badge mono', text });
  if (def.readOnly) {
    const b = readBadge('—'); row.append(b);
    setUI = (raw) => { b.textContent = def.type === 'bool' ? (raw === 1 ? 'Oui' : 'Non') : def.type === 'enum' ? (def.options[raw] ?? String(raw)) : fmtParamValue(def, paramFromCode(def, raw), raw); };
  } else if (def.type === 'bool') {
    const cb = h('input', { type: 'checkbox', 'aria-label': def.label, onchange: () => write(cb.checked ? 1 : 0, () => { cb.checked = !cb.checked; }) });
    row.append(h('label', { class: 'switch' }, cb, h('i')));
    setUI = (raw) => { cb.checked = raw === 1; };
  } else if (def.type === 'enum') {
    const opts = Object.entries(def.options);
    if (opts.length <= 6 && opts.every(([, l]) => l.length <= 16)) {
      const seg = h('div', { class: 'seg wrap' }, opts.map(([v, l]) => h('button', { 'data-v': v, type: 'button', text: l, onclick: () => write(v) })));
      row.append(seg);
      setUI = (raw) => {
        const no = App.unsupported(code);
        $$('button', seg).forEach((b) => { b.classList.toggle('active', +b.dataset.v === raw && !def.writeOnly); b.hidden = no.includes(+b.dataset.v) && +b.dataset.v !== raw; });
      };
    } else {
      const sel = h('select', { 'aria-label': def.label, style: 'max-width:220px', onchange: () => write(sel.value) }, opts.map(([v, l]) => h('option', { value: v, text: l })));
      row.append(sel);
      let optKey = '';
      setUI = (raw) => {
        // Liste propre au modèle connecté (ex. configuration des enceintes de la famille SC-LX79)
        const m = App.state?.model || '', alt = def.byModel?.find((b) => new RegExp(b.re).test(m));
        const no = App.unsupported(code), key = (alt ? m : '') + no.join();
        if (key !== optKey) { optKey = key; sel.innerHTML = ''; for (const [v, l] of Object.entries(alt ? alt.options : def.options)) if (!no.includes(+v)) sel.add(new Option(l, v)); }
        if (![...sel.options].some((o) => o.value === String(raw))) sel.add(new Option(`Valeur ${raw}`, String(raw)));
        sel.value = String(raw);
      };
    }
  } else {
    const r = h('input', { type: 'range', min: def.min, max: def.max, step: def.step || 1, 'aria-label': def.label, style: 'flex:1;min-width:110px' });
    const val = h('b', { class: 'mono', style: 'min-width:64px;text-align:right' });
    const send = throttle((v) => App.set(code, paramToCode(def, v), false), 140);
    r.addEventListener('input', () => { dragging = true; rangeFill(r); val.textContent = fmtParamValue(def, +r.value, paramToCode(def, +r.value)); if (!def.risky) send(+r.value); });
    r.addEventListener('change', () => { dragging = false; if (def.risky) write(paramToCode(def, +r.value)); });
    row.append(h('div', { class: 'row', style: 'flex:1;justify-content:flex-end;flex-wrap:nowrap' }, r, val));
    setUI = (raw) => {
      if (dragging) return;
      const v = paramFromCode(def, raw);
      r.value = clamp(v, def.min, def.max); rangeFill(r); val.textContent = fmtParamValue(def, v, raw);
    };
  }
  return {
    el: row, code,
    update(s) {
      const raw = s.params[code];
      // Les réglages en écriture seule n'ont pas de valeur lisible : on les montre tant que l'ampli est connecté.
      // (sauf sur un ampli eISCP, qui n'a aucun de ces réglages classiques)
      row.hidden = raw === undefined && (!def.writeOnly || s.protocol === 'eiscp');
      if (raw !== undefined) { lastRaw = raw; setUI(raw); } else if (def.writeOnly) setUI(-1);
    },
  };
}

// Les réglages dépendant du mode d'écoute répondent « NOT AVAILABLE » sur l'afficheur : on le signale.
App.markWrite = function markWrite() { this.lastWrite = Date.now(); };
const _origSet = App.set, _origCmd = App.cmd;
// Après une écriture, l'ampli renvoie la valeur réellement appliquée : si elle diffère, il a refusé (mode/source incompatible).
App.set = function set(code, value, confirm) {
  this.markWrite();
  const def = this.meta.params?.[code], before = this.state?.params?.[code], r = _origSet.call(this, code, value, confirm);
  if (def && !def.writeOnly && !def.readOnly) {
    setTimeout(() => {
      const now = this.state?.params?.[code];
      if (now !== undefined && now !== +value && !(Date.now() - (this.rejected?.[code] || 0) < 3000)) {
        const o = def.options?.[now];
        // L'ampli a changé de valeur, mais pas pour celle demandée : ce modèle ne connaît pas cette option
        // (ex. VSX-921 : Dialog Enhancement Up 1 à 4 ramenés à Off/Flat). On la retire de la liste pour ce modèle.
        if (def.type === 'enum' && before !== undefined && now !== before) {
          this.markUnsupported(code, +value);
          _origSet.call(this, code, before, confirm);   // on annule ce changement non demandé
          this.problem({ title: `« ${def.label} : ${def.options[value] ?? value} » n'existe pas sur ce modèle (l'ampli est passé à ${o ?? now})`, advice: 'Cette option est désormais masquée pour ce modèle.', raw: `${code} ${value} → ${now}` });
        } else this.problem({ title: `« ${def.label} » refusé par l'ampli${o ? ` (reste sur ${o})` : ''} : indisponible avec la source ou le mode d'écoute actuels`, advice: "Change de mode d'écoute ou de source, puis réessaie.", raw: `${code} ${value} → ${now}` });
        this.render();
      }
    }, 1800);
  }
  return r;
};
// Options qu'un modèle remplace par une autre : mémorisées par modèle, masquées dans les listes.
App.unsupported = function unsupported(code) { return store.get(`unsup:${this.state?.model || ''}`, {})[code] || []; };
// Options qui existent ensemble ou pas du tout (Dialog Enhancement : Up 1 à 4, absents du VSX-921)
const OPTION_FAMILIES = { ATH: [2, 3, 4, 5] };
App.markUnsupported = function markUnsupported(code, v) {
  const k = `unsup:${this.state?.model || ''}`, all = store.get(k, {});
  const fam = OPTION_FAMILIES[code]?.includes(v) ? OPTION_FAMILIES[code] : [v];
  all[code] = [...new Set([...(all[code] || []), ...fam])];
  store.set(k, all);
};
App.cmd = function cmd(name, arg) { this.markWrite(); return _origCmd.call(this, name, arg); };

// Construit un composant dès que les métadonnées du serveur (liste des paramètres) sont arrivées.
function lazy(factory) {
  const el = h('div'); let inst = null;
  return { el, update(s) { if (!inst && Object.keys(App.meta.params).length) { inst = factory(); el.append(inst.el); } inst?.update(s); } };
}
