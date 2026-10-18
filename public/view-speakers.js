'use strict';
// Vue Enceintes : salle interactive, état des canaux (AST), niveaux (ILV), emphase par glisser-déposer, écoute isolée.
(function speakers() {
  const el = h('section', { class: 'view', 'data-view': 'speakers' });
  const W = 600, H = 520, LISTENER = { x: 300, y: 285 };
  const DEFAULT_POS = {
    FL: [150, 110], C: [300, 78], FR: [450, 110], FWL: [78, 205], FWR: [522, 205], SL: [62, 300], SR: [538, 300],
    SBL: [150, 440], SB: [300, 468], SBR: [450, 440], FHL: [220, 160], FHR: [380, 160], SW: [48, 52],
  };
  const SMALL = new Set(['FHL', 'FHR', 'FWL', 'FWR']);
  let pos = { ...DEFAULT_POS, ...store.get('layout', {}) };
  let selected = 'FL', editLayout = false, emphasis = false, base = null, puck = { ...LISTENER }, draggingLevel = false;

  const chans = () => App.meta.channels;
  const idxOf = (c) => chans().indexOf(c);
  const dbOf = (v) => (v - 50) / 2;
  const fmtDb = (v) => `${dbOf(v) > 0 ? '+' : ''}${dbOf(v).toFixed(1)} dB`;

  /* --- salle --- */
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'room', role: 'img', 'aria-label': 'Plan de la salle et des enceintes' });
  for (const r of [90, 170, 250]) svg.append(S('circle', { class: 'ring', cx: LISTENER.x, cy: LISTENER.y, r }));
  svg.append(S('text', { x: W / 2, y: 22, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)', style: 'letter-spacing:.2em' }, 'AVANT'));
  svg.append(S('g', { transform: `translate(${LISTENER.x},${LISTENER.y})`, style: 'pointer-events:none' },
    S('circle', { r: 15, fill: 'var(--panel2)', stroke: 'var(--line2)', 'stroke-width': 2 }),
    S('circle', { r: 3, cy: -5, fill: 'var(--muted)' }), S('path', { d: 'M-8 6a9 7 0 0 0 16 0', fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2 })));
  const links = S('g', { style: 'pointer-events:none' });
  svg.append(links);
  const nodes = {};
  function buildNodes() {
    for (const n of Object.values(nodes)) n.g.remove();
    for (const c of Object.keys(DEFAULT_POS)) {
      const r = SMALL.has(c) ? 17 : 22;
      const g = S('g', { class: 'spk', tabindex: 0, role: 'button', 'aria-label': App.meta.channelNames[c] || c },
        S('circle', { class: 'wave', r: 20, cx: 0, cy: 0 }), S('circle', { class: 'body', r }),
        S('text', { y: 4 }, c), S('text', { class: 'lvl', y: r + 14 }, ''));
      g.addEventListener('click', () => { if (!moved) { selected = c; update(App.state); } });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { selected = c; update(App.state); } });
      g.addEventListener('pointerdown', (e) => startDrag(e, c));
      svg.append(g); nodes[c] = { g, r };
    }
  }
  const puckEl = S('g', { class: 'puck', style: 'display:none' }, S('circle', { r: 13 }), S('text', { y: 4 }, 'ÉCOUTE'));
  svg.append(puckEl);
  const toSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: clamp(q.x, 20, W - 20), y: clamp(q.y, 30, H - 20) }; };

  /* --- glisser : enceintes (mode disposition) et point d'écoute (emphase) --- */
  let drag = null, moved = false;
  function startDrag(e, c) {
    moved = false;
    if (!editLayout) return;
    drag = { c }; svg.setPointerCapture(e.pointerId); e.preventDefault();
  }
  puckEl.addEventListener('pointerdown', (e) => { drag = { puck: true }; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    moved = true;
    const p = toSvg(e);
    if (drag.puck) { puck = p; placePuck(); applyEmphasis(); }
    else { pos[drag.c] = [p.x, p.y]; placeNode(drag.c); }
  });
  const endDrag = () => { if (drag?.c) store.set('layout', pos); drag = null; setTimeout(() => (moved = false), 0); };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);

  const placeNode = (c) => { nodes[c].g.setAttribute('transform', `translate(${pos[c][0]},${pos[c][1]})`); };
  const placePuck = () => { puckEl.setAttribute('transform', `translate(${puck.x},${puck.y})`); };

  // Emphase : plus le point d'écoute est proche d'une enceinte, plus elle monte (±6 dB max, centrée sur la moyenne).
  const sendLevels = throttle((vals) => App.api('/api/levels', { values: vals }).catch(() => {}), 140);
  function applyEmphasis() {
    if (!emphasis || !base) return;
    const act = Object.keys(pos).filter((c) => c !== 'SW' && idxOf(c) >= 0 && isActive(c));
    if (!act.length) return;
    const dist = (c) => Math.hypot(pos[c][0] - puck.x, pos[c][1] - puck.y);
    const mean = act.reduce((a, c) => a + dist(c), 0) / act.length;
    const vals = [...base];
    for (const c of act) {
      const off = clamp(((mean - dist(c)) / 110) * 6, -6, 6);
      vals[idxOf(c)] = clamp(Math.round(base[idxOf(c)] + off * 2), 26, 74);
    }
    sendLevels(vals);
  }

  /* --- état d'un canal --- */
  const hasAudio = () => !!App.state?.audio;
  const isActive = (c) => { const a = App.state?.audio; const i = idxOf(c); return !!(a && i >= 0 && a.output[i]); };
  const isInput = (c) => { const a = App.state?.audio; const i = (App.meta.inputChannels || []).indexOf(c); return !!(a && i >= 0 && a.input[i]); };
  const flatLevels = () => Array((App.state?.levels || chans()).length).fill(50);
  const levelOf = (c) => { const l = App.state?.levels, i = idxOf(c); return l && i >= 0 ? l[i] : null; };

  /* --- panneau de détail --- */
  const dName = h('h3'), dBadges = h('div', { class: 'chips' });
  const dSlider = h('input', { type: 'range', min: 26, max: 74, step: 1, value: 50, 'aria-label': 'Niveau de l\'enceinte' });
  const dVal = h('b', { text: '—' });
  const sendOne = throttle((c, v) => {
    const l = [...(App.state.levels || flatLevels())]; l[idxOf(c)] = v;
    App.state.levels = l; App.api('/api/levels', { values: l }).catch(() => {});
  }, 120);
  dSlider.addEventListener('input', () => { draggingLevel = true; rangeFill(dSlider); dVal.textContent = fmtDb(+dSlider.value); sendOne(selected, +dSlider.value); });
  dSlider.addEventListener('change', () => { draggingLevel = false; });
  const solo = h('button', { class: 'btn', text: 'Isoler (maintenir)', title: 'Maintiens appuyé : les autres canaux descendent au minimum' });
  const restoreSolo = () => App.api('/api/solo', { restore: true }).catch(() => {});
  let soloOn = false;
  solo.addEventListener('pointerdown', (e) => { soloOn = true; solo.setPointerCapture(e.pointerId); App.api('/api/solo', { index: idxOf(selected) }).catch(() => {}); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) solo.addEventListener(ev, () => { if (soloOn) { soloOn = false; restoreSolo(); } });
  window.addEventListener('blur', () => { if (soloOn) { soloOn = false; restoreSolo(); } });
  window.addEventListener('pagehide', () => { if (soloOn) navigator.sendBeacon?.('/api/solo', new Blob([JSON.stringify({ restore: true })], { type: 'application/json' })); });
  const detail = h('div', { class: 'card' },
    h('header', {}, dName, dBadges),
    h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('span', { class: 'muted', text: 'Niveau du canal' }), dVal), dSlider,
      h('div', { class: 'row' }, h('button', { class: 'btn small', text: '0 dB', onclick: () => { dSlider.value = 50; dSlider.dispatchEvent(new Event('input')); } }), solo)),
    h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Niveaux au pas de 0,5 dB (±12 dB). Active = le canal reçoit du signal dans le mode d\'écoute actuel.' }));

  /* --- commandes de la vue --- */
  const emphToggle = h('input', { type: 'checkbox', onchange: () => {
    emphasis = emphToggle.checked;
    if (emphasis) { base = [...(App.state.levels || flatLevels())]; puck = { ...LISTENER }; placePuck(); puckEl.style.display = ''; App.toast('Balance dirigée : glisse le point bleu, les niveaux changent en direct'); }
    else { puckEl.style.display = 'none'; if (base) { App.api('/api/levels', { values: base }).catch(() => {}); base = null; App.toast('Niveaux d\'origine rétablis'); } }
  } });
  const editToggle = h('input', { type: 'checkbox', onchange: () => { editLayout = editToggle.checked; svg.style.cursor = editLayout ? 'move' : ''; App.toast(editLayout ? 'Glisse les enceintes pour les placer' : 'Disposition enregistrée'); } });
  const resetLayout = h('button', { class: 'btn small', text: 'Disposition par défaut', onclick: () => { pos = { ...DEFAULT_POS }; store.set('layout', {}); for (const c of Object.keys(nodes)) placeNode(c); } });
  const resetLevels = h('button', { class: 'btn small danger', text: 'Tous à 0 dB', onclick: async () => {
    if (await confirmDialog('Remettre tous les niveaux à 0 dB ?', 'Tous les niveaux de canaux seront remis à zéro sur le récepteur.')) { base = null; emphToggle.checked = false; emphasis = false; puckEl.style.display = 'none'; App.api('/api/levels', { values: flatLevels() }); }
  } });
  const spkSeg = h('div', { class: 'seg' });
  const spkHint = h('small', { class: 'muted' });
  const table = h('table', { class: 'ctable' });
  const sscList = h('div', { class: 'chips' });

  el.append(
    h('div', { class: 'grid g-spk' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('header', {}, h('h2', { text: 'Salle d\'écoute' }), h('span', { class: 'badge', id: 'spkMode' })),
          svg,
          h('div', { class: 'row between' },
            h('label', { class: 'row', style: 'gap:8px' }, h('span', { class: 'switch' }, emphToggle, h('i')), 'Balance dirigée (point d\'écoute)'),
            h('label', { class: 'row', style: 'gap:8px' }, h('span', { class: 'switch' }, editToggle, h('i')), 'Déplacer les enceintes'),
            resetLayout))),
      h('div', { class: 'stack' }, detail,
        h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Système d\'enceintes' }), spkHint), spkSeg),
        h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Niveaux' }), resetLevels), table))),
    h('div', { class: 'card', style: 'margin-top:16px' }, h('header', {}, h('h2', { text: 'Réglages système (SSC, lecture)' }), h('span', { class: 'muted', text: 'Écriture : voir Terminal, format « ccivv SSC »' })), sscList));

  let built = false, tableKey = '';
  App.on('meta', () => { built = false; tableKey = ''; spkSeg.innerHTML = ''; });
  function build() {
    if (built || !chans().length) return;
    built = true; buildNodes();
    for (const c of Object.keys(pos)) placeNode(c);
    placePuck();
  }

  function update(s) {
    build();
    const a = s.audio;
    $('#spkMode', el).textContent = App.modeName(s.mode);
    for (const [c, { g }] of Object.entries(nodes)) {
      const act = isActive(c), lv = levelOf(c), off = a && !act;
      g.classList.toggle('active', act); g.classList.toggle('sel', c === selected); g.classList.toggle('off', !!off);
      g.lastChild.textContent = lv == null ? '' : `${dbOf(lv) > 0 ? '+' : ''}${dbOf(lv).toFixed(1)}`;
    }
    const c = selected, lv = levelOf(c);
    // Deux nœuds de texte : le nom du canal (« Avant G ») est ainsi traduit seul
    const chName = App.meta.channelNames[c] || c;
    if (dName.dataset.ch !== c + chName) { dName.dataset.ch = c + chName; dName.replaceChildren(`${c} · `, chName); }
    dBadges.innerHTML = '';
    dBadges.append(h('span', { class: `badge ${isActive(c) ? 'ok' : ''}`, text: !a ? 'état inconnu' : isActive(c) ? 'sortie active' : 'inactive' }));
    if (isInput(c)) dBadges.append(h('span', { class: 'badge', text: 'dans le signal source' }));
    if (!draggingLevel && lv != null) { dSlider.value = lv; rangeFill(dSlider); dVal.textContent = fmtDb(lv); }
    solo.disabled = lv == null; dSlider.disabled = lv == null;

    // Système d'enceintes (SPK)
    const sp = App.meta.params.SPK;
    if (sp) {
      if (!spkSeg.childElementCount) {
        for (const [v, label] of Object.entries(sp.options)) spkSeg.append(h('button', { 'data-v': v, text: label, onclick: () => App.set('SPK', v) }));
        spkHint.textContent = sp.hint || '';
      }
      $$('button', spkSeg).forEach((b) => b.classList.toggle('active', s.spk === +b.dataset.v));
    }
    // Tableau des canaux et SSC : reconstruits seulement quand leur contenu change (sinon un clic peut se perdre)
    const tk = JSON.stringify([s.levels, a?.output, s.ssc, App.meta.channelNames]);
    if (tk === tableKey) return;
    tableKey = tk;
    table.innerHTML = '';
    table.append(h('thead', {}, h('tr', {}, h('th', { text: 'Canal' }), h('th', { text: 'État' }), h('th', { text: 'Niveau' }))));
    const body = h('tbody');
    for (const ch of Object.keys(DEFAULT_POS)) {
      const l = levelOf(ch);
      body.append(h('tr', { onclick: () => { selected = ch; update(App.state); } },
        h('td', {}, h('span', { class: `pill ${isActive(ch) ? 'on' : ''}` }), App.meta.channelNames[ch] || ch),
        h('td', { class: 'muted', text: !a ? '—' : isActive(ch) ? 'actif' : 'inactif' }),
        h('td', { class: 'mono', text: l == null ? '—' : fmtDb(l) })));
    }
    table.append(body);
    // SSC
    sscList.innerHTML = '';
    const ssc = Object.entries(s.ssc || {});
    if (!ssc.length) sscList.append(h('span', { class: 'muted', text: 'Aucune donnée (interrogation en cours…)' }));
    for (const [k, v] of ssc) sscList.append(h('span', { class: 'badge mono', text: `${k.slice(0, 2)}.${k.slice(2)} = ${String(v).padStart(2, '0')}` }));
  }
  // La disposition peut venir d'une sauvegarde restaurée : on la relit à chaque ouverture.
  const onShow = () => { pos = { ...DEFAULT_POS, ...store.get('layout', {}) }; if (built) for (const c of Object.keys(nodes)) placeNode(c); };
  App.register('speakers', { el, update, onShow, title: 'Enceintes', icon: 'speaker', available: (s) => App.caps(s).speakers });
})();
