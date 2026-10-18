'use strict';
// Vues : Accueil (afficheur, volume, entrées, mode), Zone 2, Radio.

const SIGNALS = ['ANALOG', 'ANALOG', 'ANALOG', 'PCM', 'PCM', 'DOLBY DIGITAL', 'DTS', 'DTS-ES Matrix', 'DTS-ES Discrete', 'DTS 96/24',
  'DTS 96/24 ES Matrix', 'DTS 96/24 ES Discrete', 'MPEG-2 AAC', 'WMA9 Pro', 'DSD→PCM', 'HDMI THROUGH', 'DOLBY DIGITAL PLUS', 'DOLBY TrueHD',
  'DTS EXPRESS', 'DTS-HD Master Audio', 'DTS-HD High Resolution', ...Array(6).fill('DTS-HD High Resolution'), 'DTS-HD Master Audio',
  'DSD', 'Dolby Atmos', 'Dolby Atmos (DD+)', 'Dolby Atmos (TrueHD)'];
// Fichiers et services réseau (codes 64 à 72, modèles récents)
Object.assign(SIGNALS, { 64: 'MP3', 65: 'WAV', 66: 'WMA', 67: 'MPEG-4 AAC', 68: 'FLAC', 69: 'ALAC', 70: 'AIFF', 71: 'DSD (USB-DAC)', 72: 'Spotify' });
const FREQS = { 0: '32 kHz', 1: '44,1 kHz', 2: '48 kHz', 3: '88,2 kHz', 4: '96 kHz', 5: '176,4 kHz', 6: '192 kHz', 32: '2,8 MHz', 33: '5,6 MHz' };
const PQLS = { 1: 'PQLS 2ch', 2: 'PQLS multicanal', 3: 'PQLS bitstream' };
const signalText = (a) => {
  if (!a) return '—';
  let t = `${SIGNALS[+a.signal] || 'Signal ' + a.signal} · ${FREQS[+a.freq] || ''}`.trim().replace(/·\s*$/, '');
  // Modèles récents : format de sortie (fréquence / résolution) et PQLS
  if (a.outFreq !== undefined && FREQS[+a.outFreq]) t += ` → ${FREQS[+a.outFreq]}${a.outBits ? ` / ${a.outBits} bits` : ''}`;
  if (PQLS[a.pqls]) t += ` · ${PQLS[a.pqls]}`;
  return t;
};

/* ---------- Aides ---------- */
function inputIcon(name) {
  if (/TUNER|RADIO/i.test(name)) return 'radio';
  if (/TV|SAT|CBL|HDMI|MHL/i.test(name)) return 'tv';
  if (/BD|DVD|DVR|CD|PHONO|TAPE/i.test(name)) return 'disc';
  if (/USB|iPod|ADAPTER|NETWORK|MEDIA|H\.M\.G|FAVOR/i.test(name)) return 'usb';
  return 'plug';
}
// Un appui = une commande ; maintenu, la commande se répète (volume).
function holdRepeat(btn, name) {
  let t1, t2;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', (e) => { if (e.button) return; App.cmd(name); t1 = setTimeout(() => { t2 = setInterval(() => App.cmd(name), 160); }, 450); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) App.cmd(name); else App.cmd(name); } });
  return btn;
}

/* ---------- Cadran de volume ---------- */
function VolumeDial(onChange) {
  const C = 100, R = 78, START = 135, SWEEP = 270;
  const MAXf = () => App.volScale().max, ZEROf = () => App.volScale().zero;   // échelle propre à chaque modèle
  const pt = (deg, r = R) => { const a = (deg * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `M${x0} ${y0} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const track = S('path', { d: arc(START, START + SWEEP), fill: 'none', stroke: 'var(--line2)', 'stroke-width': 12, 'stroke-linecap': 'round' });
  const val = S('path', { fill: 'none', stroke: 'var(--accent)', 'stroke-width': 12, 'stroke-linecap': 'round' });
  const zero = S('line', { stroke: 'var(--muted)', 'stroke-width': 2 });
  const cap = S('line', { stroke: 'var(--bad)', 'stroke-width': 3, 'stroke-linecap': 'round' });
  const knob = S('circle', { r: 11, fill: '#fff', stroke: 'var(--accent)', 'stroke-width': 4, style: 'cursor:grab;filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))' });
  const big = S('text', { x: C, y: C + 4, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700 });
  const sub = S('text', { class: 'sub', x: C, y: C + 24, 'text-anchor': 'middle', 'font-size': 10 });
  const lab = S('text', { class: 'sub', x: C, y: C - 26, 'text-anchor': 'middle', 'font-size': 10 }, 'VOLUME');
  const svg = S('svg', { viewBox: '0 0 200 200', class: 'dial' }, track, val, zero, cap, knob, lab, big, sub);
  let value = 0, dragging = false, max = 161, muted = false;
  const send = throttle((v) => onChange(v), 110);
  const ang = (v) => START + (v / MAXf()) * SWEEP;
  const tick = (el, v, r0, r1) => { const [x0, y0] = pt(ang(v), r0), [x1, y1] = pt(ang(v), r1); el.setAttribute('x1', x0); el.setAttribute('y1', y0); el.setAttribute('x2', x1); el.setAttribute('y2', y1); };
  function draw() {
    val.setAttribute('d', value > 0 ? arc(START, ang(value)) : '');
    val.setAttribute('stroke', muted ? 'var(--muted)' : 'var(--accent)');
    const [kx, ky] = pt(ang(value)); knob.setAttribute('cx', kx); knob.setAttribute('cy', ky);
    tick(zero, ZEROf(), R - 11, R + 11); tick(cap, Math.min(max, MAXf()), R - 11, R + 11);
    big.textContent = App.volText(value).replace(' dB', ''); sub.textContent = muted ? 'MUTE' : `dB · réf ${value}`;
  }
  function fromEvent(e) {
    const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 200 - C, y = ((e.clientY - r.top) / r.height) * 200 - C;
    let a = (Math.atan2(y, x) * 180) / Math.PI - START; a = ((a % 360) + 360) % 360;
    if (a > SWEEP) a = a > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
    return clamp(Math.round((a / SWEEP) * MAXf()), 0, Math.min(max, MAXf()));
  }
  svg.addEventListener('pointerdown', (e) => {
    // On ne démarre qu'en saisissant le bouton : évite un saut brutal de volume sur un simple clic.
    const r = svg.getBoundingClientRect(), [kx, ky] = pt(ang(value));
    const d = Math.hypot(((e.clientX - r.left) / r.width) * 200 - kx, ((e.clientY - r.top) / r.height) * 200 - ky);
    if (d > 24) return;
    dragging = true; svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => { if (!dragging) return; value = fromEvent(e); draw(); send(value); });
  const end = () => { if (dragging) { dragging = false; onChange(value); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  // Molette : seulement si la souris s'est posée sur le bouton ; une page qu'on fait défiler en passant dessus
  // ne doit pas changer le volume (constaté en essai : −1 dB involontaire).
  let restAt = 0, lastPageWheel = 0;
  svg.addEventListener('pointerenter', () => { restAt = Date.now(); });
  svg.addEventListener('pointermove', () => { if (!restAt) restAt = Date.now(); });
  svg.addEventListener('pointerleave', () => { restAt = 0; });
  svg.addEventListener('wheel', (e) => {
    const now = Date.now();
    if (!restAt || now - restAt < 500 || now - lastPageWheel < 400) { lastPageWheel = now; restAt = now; return; }
    e.preventDefault(); value = clamp(value + (e.deltaY < 0 ? 2 : -2), 0, Math.min(max, MAXf())); draw(); send(value); }, { passive: false });
  return { el: svg, set(v, m, cp) { max = cp; muted = m; if (!dragging && v != null) value = v; draw(); }, get dragging() { return dragging; } };
}

/* ---------- Accueil ---------- */
(function home() {
  const el = h('section', { class: 'view', 'data-view': 'home' });
  const l1 = h('div', { class: 'l1', text: '—' });
  const sigEl = h('span'), modeEl = h('span'), inEl = h('span');
  const lcd = h('div', { class: 'lcd' }, l1, h('div', { class: 'l2' }, inEl, modeEl, sigEl));
  const dial = VolumeDial((v) => App.cmd('volumeSet', v));
  // Minuterie de veille à portée de main (même réglage que dans Installation)
  const sleep = lazy(() => ParamRow('SAB', { compact: true }));
  const dialCard = h('div', { class: 'card' },
    lcd,
    h('div', { class: 'dial-wrap' }, dial.el),
    h('div', { class: 'vol-btns' },
      holdRepeat(h('button', { class: 'btn', text: '−', 'aria-label': 'Volume moins' }), 'volumeDown'),
      h('button', { class: 'btn', id: 'homeMute', html: icon('mute'), 'aria-label': 'Mute', onclick: () => App.cmd(App.state?.mute ? 'muteOff' : 'muteOn') }),
      holdRepeat(h('button', { class: 'btn', text: '+', 'aria-label': 'Volume plus' }), 'volumeUp')),
    h('p', { class: 'muted', style: 'text-align:center;margin:0;font-size:12px' }, 'Saisis le bouton blanc pour régler (limite de sécurité en rouge). Molette = ±1 dB.'),
    sleep.el);

  const tiles = h('div', { class: 'tiles' });
  const modeSel = h('select', { 'aria-label': 'Mode d\'écoute', onchange: (e) => { App.noteModeChange(e.target.value); App.cmd('modeSet', e.target.value); } });
  const presetsRow = h('div', { class: 'chips' });
  const presetsCard = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Presets' }), h('button', { class: 'btn small', text: 'Gérer', onclick: () => App.show('presets') })), presetsRow);
  const emph = lazy(() => EmphasisCard());
  // Lecture : seulement pour les sources réseau, iPod/USB et Bluetooth (l'ampli pilote alors le lecteur)
  const media = (action) => App.api('/api/media', { action }).catch(() => {});
  const mbtn = (label, action, aria) => h('button', { class: 'btn', text: label, 'aria-label': aria, title: aria, onclick: () => media(action) });
  const mediaCard = h('div', { class: 'card', hidden: true }, h('header', {}, h('h2', { text: 'Lecture' })),
    h('div', { class: 'row wrap media-btns' },
      mbtn('⏮', 'prev', 'Précédent'), mbtn('⏪', 'rew', 'Retour rapide'), mbtn('▶', 'play', 'Lecture'), mbtn('⏸', 'pause', 'Pause'),
      mbtn('⏹', 'stop', 'Stop'), mbtn('⏩', 'ff', 'Avance rapide'), mbtn('⏭', 'next', 'Suivant'),
      mbtn('🔁', 'repeat', 'Répétition'), mbtn('🔀', 'shuffle', 'Aléatoire')));
  const right = h('div', { class: 'stack' },
    presetsCard,
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Entrée' })), tiles),
    mediaCard,
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Mode d\'écoute' }), h('button', { class: 'btn small', text: 'Tous les modes', onclick: () => App.show('sound') })), modeSel));
  el.append(h('div', { class: 'grid g2' }, h('div', { class: 'stack' }, dialCard, emph.el), right));

  let tilesKey = '', modesKey = '', presetsKey = '';
  function update(s) {
    l1.textContent = s.power === false ? 'STANDBY' : s.display || '—';
    inEl.textContent = `IN ${App.inputName(s.input)}`; modeEl.textContent = App.modeName(s.mode); sigEl.textContent = signalText(s.audio);
    dialCard.classList.toggle('standby', s.power === false);
    dial.set(s.volume, s.mute, App.meta.maxVolume);
    sleep.update(s);
    emph.update(s);
    $('#homeMute', el).classList.toggle('on', !!s.mute);
    const ids = App.inputIds(), key = ids.join() + JSON.stringify(s.names);
    if (key !== tilesKey) {
      tilesKey = key; tiles.innerHTML = '';
      for (const id of ids) tiles.append(h('button', { class: 'tile', 'data-id': id, onclick: () => App.cmd('inputSet', id) }, h('span', { html: icon(inputIcon(App.inputName(id))) }), h('span', { text: App.inputName(id) })));
    }
    $$('.tile', tiles).forEach((t) => t.classList.toggle('active', t.dataset.id === s.input));
    mediaCard.hidden = !(s.power && App.meta.mediaSources?.[+s.input]);
    // Seuls les modes du modèle et compatibles avec le signal (stéréo / multicanal) sont proposés
    const ids2 = App.modeIds(s).filter((id) => id === s.mode || App.modeFitsSignal(id, s) !== false);
    const mk = ids2.join() + JSON.stringify(App.learned) + s.mode + s.model;
    if (mk !== modesKey) {
      modesKey = mk; modeSel.innerHTML = '';
      for (const id of ids2) modeSel.add(new Option(App.modeName(id), id));
    }
    if (s.mode) modeSel.value = s.mode;
    const pk = JSON.stringify(App.meta.presets.map((p) => p.id + p.name));
    if (pk !== presetsKey) {
      presetsKey = pk; presetsRow.innerHTML = '';
      if (!App.meta.presets.length) presetsRow.append(h('span', { class: 'muted', text: 'Aucun preset. Crée-en depuis l\'onglet Presets.' }));
      for (const p of App.meta.presets) presetsRow.append(h('button', { class: 'chip', text: p.name, onclick: () => applyPreset(p) }));
    }
  }
  App.register('home', { el, update, title: 'Accueil', icon: 'home' });
})();

/* ---------- Zones (2 et 3 selon le modèle) ---------- */
(function zones() {
  const el = h('section', { class: 'view', 'data-view': 'zone2' });
  const ZONES = [
    { id: 'z2', title: 'Zone 2', on: 'z2PowerOn', off: 'z2PowerOff', muteOn: 'z2MuteOn', muteOff: 'z2MuteOff', up: 'z2VolUp', down: 'z2VolDown', vol: 'z2VolSet', input: 'z2InputSet' },
    { id: 'z3', title: 'Zone 3', on: 'z3PowerOn', off: 'z3PowerOff', muteOn: 'z3MuteOn', muteOff: 'z3MuteOff', up: 'z3VolUp', down: 'z3VolDown', vol: 'z3VolSet', input: 'z3InputSet' },
    { id: 'hdz', title: 'HDZone', on: 'hdzPowerOn', off: 'hdzPowerOff', muteOn: 'hdzMuteOn', muteOff: 'hdzMuteOff', up: 'hdzVolUp', down: 'hdzVolDown', vol: 'hdzVolSet', input: 'hdzInputSet' },
  ];
  // Sources possibles par zone (aiopioneer) : les zones 2/3 n'ont pas les entrées HDMI ; la HDZone n'a pas les analogiques.
  const ZONE_SOURCES = {
    z2: ['04', '06', '15', '26', '38', '53', '41', '44', '45', '17', '13', '05', '01', '02', '33', '46', '47', '10'],
    hdz: ['25', '04', '06', '10', '15', '19', '20', '21', '22', '23', '24', '34', '35', '26', '38', '53', '41', '44', '45', '17', '13', '33', '31', '46', '47', '48'],
  };
  ZONE_SOURCES.z3 = ZONE_SOURCES.z2;
  const zoneInputs = (zid) => { const all = App.inputIds(), ok = all.filter((id) => ZONE_SOURCES[zid].includes(id)); return ok.length ? ok : all; };
  function ZoneCard(z) {
    const pw = h('input', { type: 'checkbox', 'aria-label': `${z.title} : alimentation`, onchange: () => App.cmd(pw.checked ? z.on : z.off) });
    const mt = h('input', { type: 'checkbox', 'aria-label': `${z.title} : mute`, onchange: () => App.cmd(mt.checked ? z.muteOn : z.muteOff) });
    const vol = h('input', { type: 'range', min: 0, max: 81, value: 0, 'aria-label': `Volume ${z.title}` });
    const volTxt = h('b', { text: '—' });
    const sel = h('select', { 'aria-label': `Entrée ${z.title}`, onchange: (e) => App.cmd(z.input, e.target.value) });
    let dragging = false, selKey = '';
    const sendVol = throttle((v) => App.cmd(z.vol, v), 120);
    vol.addEventListener('input', () => { dragging = true; if (+vol.value > (App.meta.zoneMaxVolume ?? 81)) vol.value = App.meta.zoneMaxVolume; rangeFill(vol); volTxt.textContent = `${vol.value - 81} dB`; sendVol(+vol.value); });
    vol.addEventListener('change', () => { dragging = false; });
    // Tonalité de la zone 2 (modèles récents seulement)
    const tone = z.id === 'z2' ? (() => {
      const sw = h('input', { type: 'checkbox', 'aria-label': 'Tonalité zone 2', onchange: () => App.cmd(sw.checked ? 'z2ToneOn' : 'z2ToneOff') });
      const mk = (label, cmd) => { const r = h('input', { type: 'range', min: -6, max: 6, step: 1, value: 0, 'aria-label': label }); const v = h('b', { text: '—' }); const send = throttle((n) => App.cmd(cmd, n), 140);
        r.addEventListener('input', () => { rangeFill(r); v.textContent = `${r.value > 0 ? '+' : ''}${r.value} dB`; send(+r.value); });
        return { r, v, row: h('div', { class: 'stack' }, h('div', { class: 'row between' }, label, v), r) }; };
      const b = mk('Graves', 'z2BassSet'), t = mk('Aigus', 'z2TrebleSet');
      const box = h('div', { class: 'stack', hidden: true }, h('div', { class: 'row between' }, h('b', { text: 'Tonalité' }), h('label', { class: 'switch' }, sw, h('i'))), b.row, t.row);
      return { box, update(s) { const has = s.z2.tone !== null; box.hidden = !has; if (!has) return; sw.checked = !!s.z2.tone;
        if (s.z2.bass != null) { b.r.value = s.z2.bass; rangeFill(b.r); b.v.textContent = `${s.z2.bass > 0 ? '+' : ''}${s.z2.bass} dB`; }
        if (s.z2.treble != null) { t.r.value = s.z2.treble; rangeFill(t.r); t.v.textContent = `${s.z2.treble > 0 ? '+' : ''}${s.z2.treble} dB`; } } };
    })() : null;
    const card = h('div', { class: 'card' },
      h('header', {}, h('h2', { text: z.title })),
      h('div', { class: 'param' }, h('div', {}, 'Alimentation'), h('label', { class: 'switch' }, pw, h('i'))),
      h('div', { class: 'param' }, h('div', {}, 'Mute'), h('label', { class: 'switch' }, mt, h('i'))),
      h('div', { class: 'stack' }, h('div', { class: 'row between' }, 'Volume', volTxt), vol,
        h('div', { class: 'row' }, holdRepeat(h('button', { class: 'btn', type: 'button', text: '−', 'aria-label': `Volume ${z.title} moins` }), z.down), holdRepeat(h('button', { class: 'btn', type: 'button', text: '+', 'aria-label': `Volume ${z.title} plus` }), z.up))),
      h('label', { class: 'stack' }, h('span', { class: 'muted', text: 'Entrée' }), sel),
      tone ? tone.box : null);
    return {
      el: card,
      update(s) {
        const zs = s[z.id] || {};
        card.hidden = zs.power == null;
        pw.checked = !!zs.power; mt.checked = !!zs.mute;
        if (!dragging && zs.volume != null) { vol.value = zs.volume; rangeFill(vol); volTxt.textContent = `${zs.volume - 81} dB`; }
        const ids = zoneInputs(z.id), k = ids.join() + JSON.stringify(s.names);
        if (k !== selKey) { selKey = k; sel.innerHTML = ''; for (const id of ids) sel.add(new Option(App.inputName(id), id)); }
        if (zs.input) sel.value = zs.input;
        tone?.update(s);
      },
    };
  }
  const cards = ZONES.map(ZoneCard);
  el.append(h('div', { class: 'grid g2' }, cards.map((c) => c.el)),
    h('p', { class: 'muted', id: 'zoneNote', style: 'font-size:12px' }));
  function update(s) {
    cards.forEach((c) => c.update(s));
    $('#zoneNote', el).textContent = s.z3.power === null ? "Zone 3 : non prise en charge par ce modèle (aucune réponse de l'ampli)." : '';
  }
  App.register('zone2', { el, update, title: 'Zones', icon: 'zone', available: (s) => App.caps(s).zone2 || App.caps(s).zone3 || App.caps(s).hdzone });
})();

/* ---------- Radio ---------- */
(function radio() {
  const el = h('section', { class: 'view', 'data-view': 'radio' });
  const freq = h('div', { class: 'freq', text: '—' });
  const presetTxt = h('b', { text: '—' });
  let cls = store.get('radioClass', 'A');
  const seg = h('div', { class: 'seg' });
  const band = h('div', { class: 'seg' }, h('button', { type: 'button', 'data-b': 'FM', text: 'FM', onclick: () => App.cmd('tunerBandFm') }), h('button', { type: 'button', 'data-b': 'AM', text: 'AM', onclick: () => App.cmd('tunerBandAm') }));
  const grid = h('div', { class: 'tiles', style: 'grid-template-columns:repeat(auto-fill,minmax(92px,1fr))' });
  for (const c of 'ABCDEFG') seg.append(h('button', { 'data-c': c, type: 'button', text: c, onclick: () => { cls = c; store.set('radioClass', c); update(App.state); } }));
  const direct = h('input', { placeholder: 'Fréquence : 101.5 ou 1008', inputmode: 'decimal', 'aria-label': 'Fréquence à syntoniser', autocomplete: 'off' });
  const go = (e) => {
    e?.preventDefault();
    const v = parseFloat(String(direct.value).replace(',', '.'));
    const band = v >= 76 && v <= 108 ? 'FM' : v >= 500 && v <= 1700 ? 'AM' : null;
    if (!band) { App.toast('Saisis une fréquence FM (76 à 108 MHz) ou AM (500 à 1700 kHz)', true); direct.focus(); return; }
    App.markWrite(); App.api('/api/tune', { freq: v, band }).then(() => App.toast(`Syntonisation ${band} ${v}…`)).catch(() => {});
  };
  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' },
      h('header', {}, h('h2', { text: 'Tuner' }), h('button', { class: 'btn small', type: 'button', text: 'Passer sur TUNER', onclick: () => App.cmd('inputSet', '02') })),
      freq,
      h('div', { class: 'row', style: 'justify-content:center' }, band),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn', type: 'button', text: '◀ Fréq', onclick: () => App.cmd('tunerFreqDown') }), h('button', { class: 'btn', type: 'button', text: 'Fréq ▶', onclick: () => App.cmd('tunerFreqUp') })),
      h('form', { class: 'row', onsubmit: go }, direct, h('button', { class: 'btn', text: 'Aller à' })),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn', type: 'button', text: '◀ Preset', onclick: () => App.cmd('tunerPresetDown') }), h('span', {}, 'Preset ', presetTxt), h('button', { class: 'btn', type: 'button', text: 'Preset ▶', onclick: () => App.cmd('tunerPresetUp') }))),
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Mémoires' }), seg), grid,
      h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Les noms viennent du récepteur. Pour mémoriser une station, utilise la face avant ou la télécommande.' }))));
  let gridKey = '';
  function update(s) {
    if (!s) return;
    freq.textContent = s.tuner.freq == null ? '—' : s.tuner.band === 'FM' ? `${s.tuner.freq.toFixed(2)} MHz` : `${s.tuner.freq} kHz`;
    $$('button', band).forEach((b) => b.classList.toggle('active', b.dataset.b === s.tuner.band));
    presetTxt.textContent = s.tuner.preset || '—';
    $$('button', seg).forEach((b) => b.classList.toggle('active', b.dataset.c === cls));
    // Reconstruit seulement si quelque chose a changé : un bouton remplacé entre l'appui et le relâchement perd le clic.
    const gk = cls + s.tuner.preset + JSON.stringify(s.tuner.names);
    if (gk === gridKey) return;
    gridKey = gk; grid.innerHTML = '';
    for (let n = 1; n <= 9; n++) {
      const id = `${cls}${String(n).padStart(2, '0')}`, name = s.tuner.names[`${cls}${n}`];
      grid.append(h('button', { type: 'button', class: `station ${name ? 'has' : ''} ${s.tuner.preset === id ? 'active' : ''}`, onclick: () => App.cmd('tunerPreset', id) }, `${cls}${n}`, h('small', { text: name || '—' })));
    }
  }
  App.register('radio', { el, update, title: 'Radio', icon: 'radio', available: (s) => App.caps(s).tuner });
})();
