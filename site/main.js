'use strict';
// Vitrine Pioneer Remote : afficheur + bouton de volume de la façade, visite guidée, lien vers le dernier APK.
const REPO = 'domblb/pioneer-remote';
const PATREON = '';   // URL de la page Patreon ; vide = bouton masqué
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* --- barre du haut --- */
const topBar = $('.top');
addEventListener('scroll', () => topBar.classList.toggle('scrolled', scrollY > 8), { passive: true });

/* --- façade : volume affiché par l'afficheur, piloté par le bouton (glisser, clavier) et par le défilement --- */
const knob = $('#knob'), vfdMain = $('#vfdMain'), vfdVol = $('#vfdVol');
const MIN = -80, MAX = 0, SWEEP = 270;   // le bouton couvre 270° de -80 dB à 0 dB
let vol = -40, idleTimer = null, booted = false;
const fmt = (v) => `${v <= -80 ? '---.-' : (v > 0 ? '+' : '') + v.toFixed(1)}dB`;
function setVol(v, announce = true) {
  vol = Math.max(MIN, Math.min(MAX, Math.round(v * 2) / 2));
  knob.style.setProperty('--rot', `${((vol - MIN) / (MAX - MIN) - .5) * SWEEP}deg`);
  knob.setAttribute('aria-valuenow', vol); knob.setAttribute('aria-valuetext', `${vol} dB`);
  vfdVol.textContent = `VOL ${fmt(vol)}`;
  if (announce && booted) {
    // Comme sur l'ampli : le volume prend tout l'afficheur un instant, puis le nom revient
    vfdMain.textContent = `VOL ${fmt(vol)}`;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { vfdMain.textContent = 'PIONEER REMOTE'; }, 1400);
  }
}

// Glisser : angle du pointeur autour du centre du bouton
let drag = null;
knob.addEventListener('pointerdown', (e) => {
  const r = knob.getBoundingClientRect();
  drag = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, last: Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) };
  knob.setPointerCapture(e.pointerId);
});
knob.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
  let d = a - drag.last;
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  drag.last = a;
  setVol(vol + (d * 180 / Math.PI) * (MAX - MIN) / SWEEP);
});
const endDrag = () => { drag = null; };
knob.addEventListener('pointerup', endDrag);
knob.addEventListener('pointercancel', endDrag);
knob.addEventListener('keydown', (e) => {
  const step = { ArrowUp: .5, ArrowRight: .5, ArrowDown: -.5, ArrowLeft: -.5, PageUp: 5, PageDown: -5 }[e.key];
  if (step) { e.preventDefault(); setVol(vol + step); }
});
knob.addEventListener('wheel', (e) => { e.preventDefault(); setVol(vol + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });

// Défilement : en quittant la façade, le volume monte de -40 à -20 dB
let lastScrollVol = null;
if (!reduced) addEventListener('scroll', () => {
  const p = Math.max(0, Math.min(1, scrollY / 520));
  const target = -40 + p * 20;
  if (lastScrollVol === null || Math.abs(target - lastScrollVol) >= .5) { lastScrollVol = target; setVol(target); }
}, { passive: true });

// Mise sous tension : les indicateurs s'allument, le nom s'écrit, le volume monte. Le seul mouvement automatique de la page.
function boot() {
  const name = 'PIONEER REMOTE', tags = $$('.vfd-tag');
  if (reduced) { vfdMain.textContent = name; setVol(-40, false); booted = true; return; }
  vfdMain.textContent = ''; tags.forEach((t) => { t.dataset.on = t.classList.contains('on'); t.classList.remove('on'); });
  let i = 0;
  const type = setInterval(() => {
    vfdMain.textContent = name.slice(0, ++i);
    if (i >= name.length) {
      clearInterval(type);
      tags.forEach((t, k) => setTimeout(() => t.classList.toggle('on', t.dataset.on === 'true'), 120 * k));
      let v = MIN;
      const ramp = setInterval(() => { v += 2.5; setVol(Math.min(v, -40), false); if (v >= -40) { clearInterval(ramp); booted = true; } }, 22);
    }
  }, 55);
}
setVol(MIN, false);
setTimeout(boot, 350);

/* --- visite : l'écran du téléphone suit le texte --- */
const tourImg = $('#tourImg');
const steps = $$('.tour-steps li');
const src = (name) => `assets/screens/${name}.webp`;
for (const li of steps) {
  // Mobile : chaque étape a sa propre capture (le téléphone fixe est masqué)
  const img = new Image(983, 2130);
  img.className = 'step-shot'; img.loading = 'lazy'; img.src = src(li.dataset.screen); img.alt = li.dataset.alt;
  li.append(img);
  new Image().src = src(li.dataset.screen);   // préchargement pour un changement d'écran sans saut
}
let current = 'home';
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    steps.forEach((s) => s.classList.toggle('active', s === e.target));
    const name = e.target.dataset.screen;
    if (name === current) continue;
    current = name;
    if (reduced) { tourImg.src = src(name); tourImg.alt = e.target.dataset.alt; continue; }
    tourImg.classList.add('swap');
    setTimeout(() => { tourImg.src = src(name); tourImg.alt = e.target.dataset.alt; tourImg.classList.remove('swap'); }, 180);
  }
}, { rootMargin: '-45% 0px -45% 0px' });
steps.forEach((s) => io.observe(s));

/* --- téléchargement : lien direct vers l'APK de la dernière version --- */
(async () => {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = await r.json();
    const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
    if (!apk) return;
    $$('[data-download]').forEach((a) => { a.href = apk.browser_download_url; });
    const mb = (apk.size / 1048576).toFixed(1);
    $('#dlInfo').textContent = `Version ${rel.tag_name.replace(/^v/, '')}, ${mb} MB, Android 7 or later. Install it straight from the file, no Play Store needed.`;
  } catch { /* hors ligne ou limite de l'API : les liens mènent à la page des versions */ }
})();

/* --- Patreon --- */
if (PATREON) { const b = $('#patreonBtn'); b.href = PATREON; b.hidden = false; }
