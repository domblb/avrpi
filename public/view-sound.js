'use strict';
// Vues : Son (emphase, modes d'écoute, réglages avancés, tonalité, égaliseur) et Vidéo.

(function sound() {
  const el = h('section', { class: 'view', 'data-view': 'sound' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* --- modes d'écoute --- */
  const search = h('input', { placeholder: 'Filtrer les modes…', 'aria-label': 'Filtrer les modes', oninput: () => { modeKey = ''; update(App.state); } });
  const modesBox = h('div', { class: 'stack' });
  const availInfo = h('p', { class: 'muted', style: 'margin:0;font-size:12px' });
  const GROUPS = [
    ['Stéréo & direct', (n) => [1, 5, 6, 7, 8, 9, 11, 112, 113].includes(n), true],
    ['Standard, Dolby, DTS, Neo', (n) => n === 10 || (n >= 12 && n <= 45), true],
    ['Surround avancé', (n) => (n >= 101 && n <= 118), true],
    ['Auto & divers', (n) => [3, 4, 151, 152, 153, 200, 212, 213].includes(n), true],
    ['THX', (n) => (n >= 51 && n <= 97) || (n >= 201 && n <= 206), false],
  ];
  // Modes plausibles sur un VSX-1021 (sans THX) : ce sont ceux que teste « Détecter ».
  const DETECT_IDS = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27, 29, 30, 31, 32, 33, 37, 38, 39, 101, 102, 103, 104, 105, 106, 107, 109, 110, 112, 113, 116, 117, 118, 151, 152, 153, 200].map((n) => String(n).padStart(4, '0'));
  const sigKey = () => `${App.state?.input}|${App.state?.audio?.signal ?? '--'}`;
  const availFor = () => (store.get('avail', {}) || {})[sigKey()];

  function buildModes(s) {
    const q = search.value.trim().toLowerCase(), cur = s.mode, avail = availFor();
    const all = App.modeIds(s), used = new Set();
    // Grisé : non détecté avec cette source, ou à défaut réservé à l'autre type de signal (stéréo / multicanal)
    const na = (id) => id !== cur && (avail ? !avail.includes(id) : App.modeFitsSignal(id, s) === false);
    modesBox.innerHTML = '';
    for (const [name, fn, open] of GROUPS) {
      const list = all.filter((id) => !used.has(id) && fn(+id)); list.forEach((id) => used.add(id));
      const shown = list.filter((id) => !q || App.modeName(id).toLowerCase().includes(q) || id.includes(q));
      if (!shown.length) continue;
      modesBox.append(h('details', { open: open || !!q || shown.includes(cur) }, h('summary', { class: 'muted', text: `${name} (${shown.length})` }),
        h('div', { class: 'chips', style: 'margin:8px 0 12px' }, shown.map((id) => h('button', {
          class: `chip ${id === cur ? 'active' : ''} ${na(id) ? 'na' : ''}`,
          title: `SR${id}${na(id) ? ' · non disponible avec cette source' : ''}`,
          text: App.modeName(id), onclick: () => App.cmd('modeSet', id) })))));
    }
    const rest = all.filter((id) => !used.has(id));
    if (rest.length) modesBox.append(h('div', { class: 'chips' }, rest.map((id) => h('button', { class: `chip ${id === cur ? 'active' : ''}`, text: App.modeName(id), onclick: () => App.cmd('modeSet', id) }))));
    availInfo.textContent = avail ? `Modes grisés = indisponibles avec « ${App.inputName(s.input)} » (détecté). ` : 'Modes grisés = prévus pour un autre type de signal (stéréo ou multicanal). « Détecter » vérifie sur le récepteur.';
  }

  async function detectModes() {
    if (!(await confirmDialog('Détecter les modes disponibles ?', "Le récepteur va essayer chaque mode d'écoute (~1 s chacun, environ une minute) pour voir lesquels la source actuelle accepte, puis revient au mode actuel. Le volume ne change pas, mais le son change pendant la détection."))) return;
    const orig = App.state.mode, key = sigKey(), found = [];
    const d = h('dialog'); document.body.append(d);
    let abort = false;
    const label = h('p', { class: 'muted', text: 'Démarrage…' }), bar = h('div', { class: 'bar' }, h('i'));
    d.append(h('h3', { text: 'Détection des modes' }), label, bar, h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Arrêter', onclick: () => { abort = true; } })));
    d.addEventListener('cancel', () => { abort = true; }); d.showModal();
    for (let i = 0; i < DETECT_IDS.length && !abort; i++) {
      const id = DETECT_IDS[i];
      label.textContent = `Mode ${i + 1}/${DETECT_IDS.length} : ${App.modeName(id)}`; bar.firstChild.style.width = `${Math.round(((i + 1) / DETECT_IDS.length) * 100)}%`;
      if (App.state.mode !== id) { await App.cmd('modeSet', id); for (let t = 0; t < 14 && App.state.mode !== id; t++) await sleep(100); }
      if (App.state.mode === id) found.push(id);
    }
    if (orig) await App.cmd('modeSet', orig);
    d.close(); d.remove();
    if (!abort) { const all = store.get('avail', {}) || {}; all[key] = found; store.set('avail', all); }
    App.toast(abort ? 'Détection interrompue' : `${found.length} mode(s) disponibles avec cette source`);
    modeKey = ''; App.render();
  }

  /* --- réglages avancés (générés depuis la liste des paramètres du serveur) --- */
  const ADV = [['dialogue', 'Dialogue, dynamique, LFE'], ['espace', 'Espace & effets'], ['synchro', 'Synchro & phase'], ['correction', 'Correction de salle'], ['signal', "Signal d'entrée"]];
  const SKIP = new Set(['ATH', 'ATM']); // déjà dans la carte Emphase
  function Advanced() {
    const rows = [];
    const box = h('div', { class: 'stack' });
    for (const [g, title] of ADV) {
      const codes = Object.keys(App.meta.params).filter((c) => App.meta.params[c].group === g && !SKIP.has(c));
      if (!codes.length) continue;
      const rs = codes.map((c) => ParamRow(c)); rows.push(...rs);
      box.append(h('details', { open: g === 'espace' }, h('summary', { class: 'muted', text: title }), h('div', {}, rs.map((r) => r.el))));
    }
    box.append(h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Certains réglages dépendent du mode d'écoute : le récepteur affiche « NOT AVAILABLE » et l'appli le signale. Absents = non gérés par ton modèle." }));
    return { el: box, update(s) { rows.forEach((r) => r.update(s)); box.closest('.card')?.toggleAttribute('hidden', rows.every((r) => r.el.hidden)); } };
  }
  const emphasis = lazy(() => EmphasisCard());
  const advanced = lazy(Advanced);
  const curves = CurvesCard();

  /* --- tonalité --- */
  const toneSw = h('input', { type: 'checkbox', onchange: () => App.cmd(toneSw.checked ? 'toneOn' : 'toneOff') });
  const mkTone = (label, name) => {
    const r = h('input', { type: 'range', min: -6, max: 6, step: 1, value: 0, 'aria-label': label }); const v = h('b', { text: '—' });
    let drag = false; const send = throttle((n) => App.cmd(name, n), 120);
    r.addEventListener('input', () => { drag = true; rangeFill(r); v.textContent = `${r.value > 0 ? '+' : ''}${r.value} dB`; send(+r.value); });
    r.addEventListener('change', () => { drag = false; });
    return { row: h('div', { class: 'stack' }, h('div', { class: 'row between' }, label, v), r), set(x) { if (drag || x == null) return; r.value = x; rangeFill(r); v.textContent = `${x > 0 ? '+' : ''}${x} dB`; } };
  };
  let toneCard = null;

  /* --- niveau d'entrée de la source en cours (modèles récents, ILA : 50 = 0 dB, ±12 dB) --- */
  const ilaR = h('input', { type: 'range', min: 26, max: 74, step: 1, value: 50, 'aria-label': "Niveau d'entrée" });
  const ilaV = h('b', { class: 'mono', text: '—' }), ilaName = h('span', { class: 'muted' });
  const ilaTxt = (u) => { const d = (u - 50) / 2; return `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`; };
  let ilaDrag = false;
  const ilaSend = throttle((u) => App.cmd('inputLevelSet', [App.state.input, u]), 150);
  ilaR.addEventListener('input', () => { ilaDrag = true; rangeFill(ilaR); ilaV.textContent = ilaTxt(+ilaR.value); ilaSend(+ilaR.value); });
  ilaR.addEventListener('change', () => { ilaDrag = false; });
  const ilaCard = h('div', { class: 'card', hidden: true }, h('header', {}, h('h2', { text: "Niveau d'entrée" }), ilaName),
    h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('span', { text: 'Gain de la source' }), ilaV), ilaR),
    h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Égalise le volume entre les sources (une source trop faible ou trop forte par rapport aux autres). Réglage mémorisé par l'ampli pour chaque entrée." }));
  const bass = mkTone('Graves', 'bassSet'), treble = mkTone('Aigus', 'trebleSet');

  /* --- égaliseur graphique : valeur 50 = 0 dB, 0,5 dB par unité, ±6 dB --- */
  const eqBox = h('div', { class: 'eq' });
  const eqMode = h('span', { class: 'badge mono' });
  let eqVals = null, eqDrag = false, eqBuilt = false;
  const eqDb = (v) => `${(v - 50) / 2 > 0 ? '+' : ''}${((v - 50) / 2).toFixed(1)}`;
  const sendEq = throttle(() => App.api('/api/eq', { values: eqVals }).catch(() => {}), 140);
  let eqCount = 0;
  function buildEq(n) {
    eqBox.innerHTML = ''; eqBuilt = true; eqCount = n;
    const { min, max } = App.meta.eqRange || { min: 38, max: 62 };
    eqBox.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    // 10 bandes : fréquences connues du VSX ; autre nombre : bandes numérotées (les fréquences dépendent du modèle)
    const label = (i) => (n === 10 ? App.meta.eqBands[i] : `B${i}`);
    for (let i = 1; i <= n; i++) {
      const r = h('input', { type: 'range', min, max, step: 1, value: 50, 'aria-label': `Bande ${label(i)}` });
      const v = h('span', { class: 'val', text: '0' });
      r.addEventListener('input', () => { eqDrag = true; eqVals[i] = +r.value; v.textContent = eqDb(+r.value); App.markWrite(); sendEq(); });
      r.addEventListener('change', () => { eqDrag = false; });
      eqBox.append(h('div', { class: 'band', 'data-i': i }, v, r, h('small', { text: label(i) })));
    }
  }

  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: "Mode d'écoute" }), h('button', { class: 'btn small', text: 'Détecter les disponibles', onclick: () => detectModes() })), search, modesBox, availInfo),
    h('div', { class: 'stack' },
      emphasis.el,
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Réglages audio' })), advanced.el),
      toneCard = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Tonalité' }), h('label', { class: 'switch' }, toneSw, h('i'))), bass.row, treble.row,
        h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Indisponible selon le mode (ex. Direct) : le récepteur affiche alors « NOT AVAILABLE ».' })),
      ilaCard)),
    h('div', { style: 'margin-top:16px' }, curves.el),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('header', {}, h('h2', { text: 'Égaliseur graphique' }), h('div', { class: 'row' }, eqMode, h('button', { class: 'btn small', text: 'Remettre à plat', onclick: () => { if (!eqVals) return; for (let i = 1; i < eqVals.length; i++) eqVals[i] = 50; $$('.band', eqBox).forEach((b) => { b.querySelector('input').value = 50; b.querySelector('.val').textContent = '0'; }); App.markWrite(); sendEq(); } }))),
      eqBox,
      h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Chaque unité = 0,5 dB, plage ±6 dB. La première valeur (mode) est conservée telle quelle.' })));

  let modeKey = '';
  function update(s) {
    const mk = `${s.mode}|${search.value}|${sigKey()}|${Object.keys(App.meta.modes).length}|${s.model}|${(s.audio?.input || []).slice(0, 3).join()}`;
    if (mk !== modeKey) { modeKey = mk; buildModes(s); }
    emphasis.update(s); advanced.update(s); curves.update(s);
    const ila = s.inputLevels?.[s.input];
    ilaCard.hidden = ila == null;
    if (ila != null) { ilaName.textContent = App.inputName(s.input); if (!ilaDrag) { ilaR.value = ila; rangeFill(ilaR); ilaV.textContent = ilaTxt(ila); } }
    toneCard.hidden = s.tone == null && s.bass == null; toneSw.checked = !!s.tone; bass.set(s.bass); treble.set(s.treble);
    const eqCard = eqBox.closest('.card'); if (eqCard) eqCard.hidden = !s.eq;
    if (s.eq && (!eqBuilt || s.eq.length - 1 !== eqCount)) buildEq(s.eq.length - 1);
    if (s.eq) {
      eqMode.textContent = `mode ${String(s.eq[0]).padStart(2, '0')}`;
      if (!eqDrag) { eqVals = [...s.eq]; $$('.band', eqBox).forEach((b) => { const i = +b.dataset.i; b.querySelector('input').value = s.eq[i]; b.querySelector('.val').textContent = eqDb(s.eq[i]); }); }
    }
  }
  App.register('sound', { el, update, title: 'Son', icon: 'sliders' });
})();

(function video() {
  const el = h('section', { class: 'view', 'data-view': 'video' });
  // Codes des documents Pioneer 2011 / FY14 / FY16 (la résolution saute 02, réservé ; 4K seulement sur les modèles récents).
  const ENUMS = {
    B: { label: 'Convertisseur vidéo', options: { 0: 'Off', 1: 'On' } },
    C: { label: 'Résolution', options: { 0: 'Auto', 1: 'Pure', 3: '480p/576p', 4: '720p', 5: '1080i', 6: '1080p', 7: '1080p/24p', 8: '4K', 9: '4K/24p' } },
    D: { label: 'Cinéma (Pure Cinema)', options: { 0: 'Auto', 1: 'On', 2: 'Off' } },
    R: { label: "Réglage noir (Black setup)", options: { 0: '0 IRE', 1: '7.5 IRE' } },
    S: { label: "Format d'image", options: { 0: 'Through', 1: 'Normal' } },
    F: { label: 'Stream Smoother', options: { 0: 'Off', 1: 'On', 2: 'Auto' } },
    G: { label: 'Advanced Video Adjust', options: { 0: 'PDP', 1: 'LCD', 2: 'FPJ', 3: 'Professional', 4: 'Mémoire' } },
    T: { label: 'Super Resolution', options: { 0: 'Off', 1: '+1', 2: '+2', 3: '+3' } },
  };
  // 50 = neutre ; plages des documents Pioneer : Prog Motion ±4, réducteurs de bruit et netteté 0…+8, image ±6.
  const SLIDERS = {
    E: ['Prog Motion', 46, 54], H: ['Y NR', 50, 58], I: ['C NR', 50, 58], J: ['Block NR', 50, 58], K: ['Mosquito NR', 50, 58],
    L: ['Detail', 50, 58], M: ['Sharpness', 50, 58], N: ['Brightness', 44, 56], O: ['Contrast', 44, 56], P: ['Hue', 44, 56], Q: ['Chroma', 44, 56],
  };
  const rel = (n) => { const d = n - 50; return d > 0 ? `+${d}` : String(d); };
  const enumBox = h('div'), sliderBox = h('div', { class: 'stack' });
  const raw = (s, k) => s.video[k];
  const width = (s, k) => String(raw(s, k)).length;
  const setVT = (s, k, n) => App.set(`VT${k}`, String(n).padStart(width(s, k), '0'));
  let dragging = false;
  const sliderEls = {};

  function build(s) {
    enumBox.innerHTML = '';
    for (const [k, def] of Object.entries(ENUMS)) {
      const v = raw(s, k); if (v === undefined) continue;
      enumBox.append(h('div', { class: 'param' }, (() => { const it = App.meta.videoHelp?.[k] ? InfoToggle(App.meta.videoHelp[k]) : {}; return h('div', {}, def.label, it.btn, h('small', { text: `VT${k}` }), it.box); })(),
        h('div', { class: 'seg wrap' }, Object.entries(def.options)
          .filter(([c]) => k !== 'C' || c < 8 || s.levelsMode === 'CLV' || +v >= 8)   // 4K : générations récentes
          .map(([c, o]) => h('button', { class: +v === +c ? 'active' : '', text: o, onclick: () => setVT(s, k, +c) })))));
    }
    if (!enumBox.children.length) enumBox.append(h('p', { class: 'muted', text: 'Aucun paramètre vidéo reçu du récepteur.' }));
    sliderBox.innerHTML = '';
    for (const [k, [name, min, max]] of Object.entries(SLIDERS)) {
      if (raw(s, k) === undefined) continue;
      const r = h('input', { type: 'range', min, max, value: +raw(s, k), 'aria-label': name });
      const val = h('b', { class: 'mono', text: rel(+raw(s, k)) });
      const send = throttle((n) => setVT(App.state, k, n), 150);
      r.addEventListener('input', () => { dragging = true; rangeFill(r); val.textContent = rel(+r.value); send(+r.value); });
      r.addEventListener('change', () => { dragging = false; });
      sliderEls[k] = { r, val };
      sliderBox.append(h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('span', {}, name, ' ', h('small', { class: 'muted', text: `VT${k}` })), val), r));
      rangeFill(r);
    }
    if (!sliderBox.children.length) sliderBox.append(h('p', { class: 'muted', text: 'Réglages avancés indisponibles (convertisseur vidéo désactivé ?).' }));
  }
  const signalBox = h('div');
  const signalCard = h('div', { class: 'card', style: 'margin-bottom:16px' }, h('header', {}, h('h2', { text: 'Signal vidéo' })), signalBox);
  el.append(signalCard);
  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Mode vidéo' })), enumBox),
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Réglages avancés' })), sliderBox,
      h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Libellés tirés de la documentation communautaire du protocole ; certains réglages sont indisponibles tant que le convertisseur vidéo est inactif." }))));
  let key = '';
  function renderSignal(s) {
    const vi = s.videoInfo; signalBox.innerHTML = '';
    if (!vi || (!vi.terminal && !vi.input.format)) { signalCard.hidden = true; return; }
    signalCard.hidden = false;
    const side = (t, o) => h('div', { class: 'param' }, h('span', { class: 'muted', text: t }), h('div', { class: 'chips' }, [o.format, o.aspect, o.color, o.bits].filter(Boolean).map((x) => h('span', { class: 'badge mono', text: x }))));
    signalBox.append(h('div', { class: 'param' }, h('span', { class: 'muted', text: 'Borne' }), h('b', { class: 'mono', text: vi.terminal || '—' })), side('Entrée', vi.input), side('Sortie', vi.output));
  }
  function update(s) {
    renderSignal(s);
    const k = JSON.stringify(Object.keys(s.video)) + Object.keys(ENUMS).map((x) => s.video[x]).join() + s.levelsMode;
    if (k !== key && !dragging) { key = k; build(s); }
    for (const [kk, e] of Object.entries(sliderEls)) if (!dragging && s.video[kk] !== undefined) { e.r.value = +s.video[kk]; e.val.textContent = rel(+s.video[kk]); rangeFill(e.r); }
  }
  App.register('video', { el, update, title: 'Vidéo', icon: 'tv', available: (s) => App.caps(s).video });
})();
