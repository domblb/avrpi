'use strict';
// Carte « Courbes 3D » : réponse en fréquence de l'égaliseur, de la tonalité et de la courbe X, en couches superposées
// (perspective), plus la courbe totale. On modifie la couche active en glissant le doigt/la souris sur le graphe.
function CurvesCard() {
  const FMIN = 20, FMAX = 20000, DB = 9;          // axes : 20 Hz–20 kHz (log), ±9 dB
  const BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const LAYERS = [
    { id: 'x', label: 'Courbe X', z: 3, color: '#7aa2ff' },
    { id: 'tone', label: 'Tonalité', z: 2, color: '#4cd4a0' },
    { id: 'eq', label: 'Égaliseur', z: 1, color: '#ff9f1c' },
    { id: 'sum', label: 'Total', z: 0, color: '#ffffff' },
  ];
  const DX = 26, DY = 14;                          // décalage de perspective par couche
  let active = 'eq', vals = null, drag = false, state = null;

  const lg = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN);
  const smooth = (x) => 1 / (1 + Math.exp(-x));
  // Gains (dB) par couche, à la fréquence f
  const gEq = (f) => {
    if (!vals) return 0;
    let g = 0;                                      // somme de cloches centrées sur chaque bande (largeur ~ 1 octave)
    for (let i = 0; i < BANDS.length; i++) {
      const d = Math.log2(f / BANDS[i]);
      g += ((vals[i + 1] ?? 50) - 50) / 2 * Math.exp(-(d * d) / 0.9);
    }
    return g;
  };
  const gTone = (f) => {
    if (!state?.tone) return 0;
    const b = state.bass || 0, t = state.treble || 0;
    return b * (1 - smooth((Math.log2(f / 150)) * 2.2)) + t * smooth((Math.log2(f / 6000)) * 2.2);
  };
  const gX = (f) => {
    const slope = xSlope();
    return f > 2000 ? slope * Math.log2(f / 2000) : 0;
  };
  function xSlope() {
    const def = App.meta.params?.SST, raw = state?.params?.SST;
    return def && raw !== undefined ? paramFromCode(def, raw) : 0;
  }
  const fns = { x: gX, tone: gTone, eq: gEq, sum: (f) => gX(f) + gTone(f) + gEq(f) };

  const cv = h('canvas', { style: 'width:100%;height:270px;touch-action:none;border-radius:12px;background:var(--panel2)' });
  const info = h('div', { class: 'muted', style: 'font-size:12px;min-height:18px' });
  const chips = h('div', { class: 'chips' }, LAYERS.filter((l) => l.id !== 'sum').map((l) =>
    h('button', { class: 'chip', 'data-l': l.id, text: l.label, onclick: () => { active = l.id; paint(); } })));

  const geo = () => {
    const w = cv.clientWidth, hgt = cv.clientHeight, padL = 34, padR = 72 + 3 * DX, padT = 12 + 3 * DY, padB = 26;
    return { w, h: hgt, x0: padL, x1: w - padR, y0: padT, y1: hgt - padB, yc: padT + (hgt - padB - padT) / 2 };
  };
  const toX = (g, f) => g.x0 + lg(f) * (g.x1 - g.x0);
  const toY = (g, db) => g.yc - (db / DB) * ((g.y1 - g.y0) / 2);

  function paint() {
    const g = geo(); if (!g.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(g.w * dpr) || cv.height !== Math.round(g.h * dpr)) { cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, g.w, g.h);
    const css = getComputedStyle(document.body), fg = css.getPropertyValue('--fg').trim() || '#eee', muted = css.getPropertyValue('--muted').trim() || '#888', line = css.getPropertyValue('--line').trim() || '#333';
    c.font = '10px system-ui,sans-serif'; c.textBaseline = 'middle';
    // Grille du plan arrière (z = 3) : décibels et fréquences
    const off = (z) => [z * DX, -z * DY];
    const [bx, by] = off(3);
    c.strokeStyle = line; c.lineWidth = 1; c.fillStyle = muted;
    for (const db of [-6, 0, 6]) { c.beginPath(); c.moveTo(g.x0 + bx, toY(g, db) + by); c.lineTo(g.x1 + bx, toY(g, db) + by); c.globalAlpha = db ? 0.5 : 1; c.stroke(); c.globalAlpha = 1; }
    c.textAlign = 'right'; for (const db of [-6, 0, 6]) c.fillText(`${db > 0 ? '+' : ''}${db}`, g.x0 + bx - 4, toY(g, db) + by);
    c.textAlign = 'center';
    for (const f of [31, 125, 500, 2000, 8000]) {
      const x = toX(g, f);
      c.beginPath(); c.moveTo(x + bx, g.y0 + by - 0); c.lineTo(x + bx, g.y1 + by); c.globalAlpha = 0.35; c.stroke(); c.globalAlpha = 1;
      c.beginPath(); c.moveTo(x + bx, g.y1 + by); c.lineTo(x, g.y1); c.globalAlpha = 0.2; c.stroke(); c.globalAlpha = 1;
      c.fillText(f >= 1000 ? `${f / 1000}k` : f, x, g.y1 + 14);
    }
    // Couches, de l'arrière vers l'avant
    const N = 120;
    for (const L of LAYERS) {
      const [ox, oy] = off(L.z), isActive = L.id === active, fn = fns[L.id];
      const pts = [];
      for (let i = 0; i <= N; i++) { const f = FMIN * Math.pow(FMAX / FMIN, i / N); pts.push([toX(g, f) + ox, toY(g, Math.max(-DB, Math.min(DB, fn(f)))) + oy]); }
      const base = toY(g, 0) + oy;
      c.beginPath(); c.moveTo(pts[0][0], base); for (const p of pts) c.lineTo(p[0], p[1]); c.lineTo(pts[N][0], base); c.closePath();
      c.fillStyle = L.color; c.globalAlpha = L.id === 'sum' ? 0.10 : isActive ? 0.28 : 0.13; c.fill(); c.globalAlpha = 1;
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.strokeStyle = L.id === 'sum' ? fg : L.color; c.lineWidth = isActive || L.id === 'sum' ? 2.5 : 1.5; c.stroke();
      c.fillStyle = L.id === 'sum' ? fg : L.color; c.textAlign = 'left';
      c.fillText(L.label, g.x1 + ox + 6, pts[N][1]);
      if (isActive && L.id === 'eq') for (let i = 0; i < BANDS.length; i++) {   // poignées des bandes
        const f = BANDS[i], x = toX(g, f) + ox, y = toY(g, Math.max(-DB, Math.min(DB, ((vals?.[i + 1] ?? 50) - 50) / 2))) + oy;
        c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = L.color; c.fill(); c.strokeStyle = '#0008'; c.lineWidth = 1; c.stroke();
      }
    }
    chips.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active',b.dataset.l === active));
    const f = active === 'x' ? `Courbe X : ${xSlope().toFixed(1)} dB/octave au-delà de 2 kHz (réglage d'installation)`
      : active === 'tone' ? (state?.tone ? `Tonalité : graves ${state.bass ?? 0} dB · aigus ${state.treble ?? 0} dB` : 'Tonalité désactivée : glisse pour l’activer')
      : (state?.eq ? 'Égaliseur : glisse un point pour régler la bande (±6 dB)' : 'Égaliseur non disponible sur ce modèle');
    info.textContent = f;
  }

  // ---- interaction ----
  const sendEq = throttle(() => App.api('/api/eq', { values: vals }).catch(() => {}), 140);
  const sendBass = throttle((n) => App.cmd('bassSet', n), 140), sendTreble = throttle((n) => App.cmd('trebleSet', n), 140);
  function edit(ev) {
    const g = geo(), r = cv.getBoundingClientRect(), L = LAYERS.find((l) => l.id === active);
    const px = ev.clientX - r.left - L.z * DX, py = ev.clientY - r.top + L.z * DY;
    const frac = Math.max(0, Math.min(1, (px - g.x0) / (g.x1 - g.x0))), f = FMIN * Math.pow(FMAX / FMIN, frac);
    const db = (g.yc - py) / ((g.y1 - g.y0) / 2) * DB;
    if (active === 'eq' && vals) {
      let bi = 0, best = 9; BANDS.forEach((b, i) => { const d = Math.abs(Math.log2(f / b)); if (d < best) { best = d; bi = i; } });
      vals[bi + 1] = Math.max(38, Math.min(62, Math.round(db * 2) + 50));
      state.eq = vals; App.markWrite(); sendEq();
    } else if (active === 'tone') {
      if (!state.tone) App.cmd('toneOn');
      const n = Math.max(-6, Math.min(6, Math.round(db)));
      if (f < 1000) { state.bass = n; sendBass(n); } else { state.treble = n; sendTreble(n); }
      App.markWrite();
    } else if (active === 'x') {
      pendingX = Math.max(-3, Math.min(0, Math.round((db / Math.max(0.1, Math.log2(Math.max(f, 2001) / 2000))) * 2) / 2));
      const def = App.meta.params?.SST; if (def) { state.params.SST = paramToCode(def, pendingX); }
    }
    paint();
  }
  let pendingX = null;
  cv.addEventListener('pointerdown', (e) => { if (active === 'eq' && !state?.eq) return; drag = true; cv.setPointerCapture(e.pointerId); edit(e); });
  cv.addEventListener('pointermove', (e) => { if (drag) edit(e); });
  const end = async () => {
    if (!drag) return; drag = false;
    if (active === 'x' && pendingX !== null) {                 // réglage d'installation : confirmation avant écriture
      const def = App.meta.params?.SST, v = pendingX; pendingX = null;
      if (def && await confirmDialog('Modifier la courbe X ?', "Ce réglage touche à la configuration de la salle. Tu pourras le remettre à sa valeur d'origine.")) App.set('SST', paramToCode(def, v), true);
      else App.render();
    }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  new ResizeObserver(paint).observe(cv);

  const el = h('div', { class: 'card' },
    h('header', {}, h('h2', { text: 'Courbes 3D' }), h('span', { class: 'badge', text: 'réponse en fréquence' })),
    chips, cv, info,
    h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Chaque couche est un réglage : choisis-en une puis glisse sur le graphe. La courbe blanche est la somme. Approximation visuelle : l’ampli ne mesure pas la réponse réelle de ta salle.' }));
  return { el, update(s) { state = s; if (!drag && s.eq) vals = [...s.eq]; chips.querySelector('[data-l="x"]').hidden = !App.meta.params?.SST; paint(); } };
}
