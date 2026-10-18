'use strict';
// Démarrage : navigation, barre du haut, bannières, raccourcis clavier, écran de connexion/découverte, mode démo.
applyTheme();

const ORDER = ['home', 'speakers', 'sound', 'video', 'install', 'zone2', 'radio', 'remote', 'presets', 'help', 'terminal', 'system'];
const PRIMARY = ['home', 'speakers', 'sound', 'presets'];       // barre du bas sur mobile ; le reste est dans « Plus »
const DESC = {
  home: 'Volume, entrées et emphase en un coup d\'œil.', install: "Calibration, HDMI, gestion de l'ampli, entrées.", remote: "Naviguer dans les menus de l'ampli.", speakers: 'La salle, les enceintes et leurs niveaux.',
  sound: 'Emphase, modes d\'écoute et réglages audio.', video: 'Convertisseur, résolution et réglages d\'image.',
  zone2: 'Piloter les zones secondaires.', radio: 'Tuner FM/AM et mémoires.', terminal: 'Envoyer des codes bruts au récepteur.',
  system: 'Sécurité, apparence, démo et raccourcis.', help: "Explications de toutes les fonctions de l'ampli.",
};
const main = $('#views');
const navBtn = (id, host) => host.append(h('button', { class: 'navbtn', 'data-view': id, type: 'button', html: `${icon(App.views[id].icon)}<span>${App.views[id].title}</span>`, onclick: () => { App.show(id); closeMore(); } }));
for (const id of ORDER) {
  const v = App.views[id];
  v.el.setAttribute('id', `view-${id}`);
  if (DESC[id]) v.el.prepend(h('div', { class: 'view-head' }, h('h1', { text: v.title }), h('p', { text: DESC[id] })));
  main.append(v.el);
  navBtn(id, $('#navlist'));
  if (PRIMARY.includes(id)) navBtn(id, $('#bottomnav'));
}
// « Plus » (mobile)
const moreList = $('#moreList'), moreSheet = $('#moreSheet');
for (const id of ORDER.filter((i) => !PRIMARY.includes(i))) navBtn(id, moreList);
const moreBtn = h('button', { class: 'navbtn', type: 'button', id: 'moreBtn', 'aria-expanded': 'false', html: `${icon('more')}<span>Plus</span>`, onclick: () => (moreSheet.hidden ? openMore() : closeMore()) });
$('#bottomnav').append(moreBtn);
function openMore() { moreSheet.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); }
function closeMore() { moreSheet.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
moreSheet.addEventListener('click', (e) => { if (e.target === moreSheet) closeMore(); });

$('#topPower').innerHTML = icon('power'); $('#topMute').innerHTML = icon('mute');
$('#topPower').onclick = () => App.cmd(App.state?.power ? 'powerOff' : 'powerOn');
$('#topMute').onclick = () => App.cmd(App.state?.mute ? 'muteOff' : 'muteOn');
$('#standbyOn').onclick = () => App.cmd('powerOn');
$('#shortcutsBtn').innerHTML = `${icon('keyboard')}<span>Raccourcis</span>`;
$('#shortcutsBtn').onclick = () => showShortcuts();

// Thème clair / sombre
const topTheme = $('#topTheme');
function syncThemeIcon() { topTheme.innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun'); }
topTheme.onclick = () => { store.set('theme', document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); applyTheme(); syncThemeIcon(); };
syncThemeIcon();

/* --- barre de synchronisation initiale + bannières --- */
const syncbar = $('#syncbar'), syncFill = $('#syncbar i');
let syncHide;
App.on('sync', ({ remaining, total }) => {
  clearTimeout(syncHide);
  if (!total || remaining === 0) { syncFill.style.width = '100%'; syncHide = setTimeout(() => syncbar.classList.remove('on'), 500); return; }
  syncbar.classList.add('on'); syncFill.style.width = `${Math.round((1 - remaining / total) * 100)}%`;
});
const demoBanner = $('#demoBanner'), standbyBanner = $('#standbyBanner');
$('#demoExit').onclick = () => App.api('/api/demo', { on: false });
function updateBanners() {
  demoBanner.hidden = !App.demo;
  standbyBanner.hidden = !(App.status === 'connected' && App.state?.power === false);
}
App.on('status', updateBanners);
const _render = App.render.bind(App);
App.render = function render() { _render(); updateBanners(); rememberAvr?.(); };

/* --- connexion --- */
const overlay = $('#connectOverlay'), msg = $('#connMsg');
let wasConnected = false;
function setMsg(t, err) { msg.textContent = t || ''; msg.className = 'muted msg' + (err ? ' err' : ''); }
App.on('status', (d) => {
  const on = d.status === 'connected';
  overlay.hidden = on;
  if (on) { wasConnected = true; setMsg(''); $('#progressWrap').hidden = true; }
  // Coupure involontaire : l'appli se reconnecte seule ; déconnexion demandée : texte d'accueil
  else if (wasConnected) $('#connLead').textContent = d.retry === false ? 'Connexion à ton récepteur VSX sur le réseau local.' : 'Connexion perdue — nouvelle tentative automatique…';
  if (d.status === 'connecting') setMsg(`Connexion à ${d.host}…`);
  if (d.status === 'disconnected' && d.error) {
    setMsg(`Erreur : ${d.error}`, true);
    // L'écran de connexion l'affiche déjà : au journal seulement (utile pour le rapport). Sans hôte, c'est le flux SSE
    // du serveur local qui s'est coupé (rechargement de la page) : rien à voir avec l'ampli.
    if (d.host) App.journal.add({ sev: 'major', title: `Connexion impossible : ${d.error}`, advice: "Vérifie que l'ampli est allumé et sur le même réseau Wi-Fi.", raw: d.host || '' });
  }
});

const logEl = $('#progressLog');
function plog(text, ok) { logEl.append(h('li', { class: ok ? 'ok' : '', text })); logEl.scrollTop = logEl.scrollHeight; while (logEl.childElementCount > 40) logEl.firstChild.remove(); }
App.on('progress', (p) => {
  $('#progressWrap').hidden = false;
  const b = $('#progressBar'), bw = $('#progressWrap .bar');
  if (p.phase === 'scan' && p.total) { bw.classList.remove('indet'); b.style.width = `${Math.round((p.done / p.total) * 100)}%`; }
  else if (p.phase === 'ssdp' || p.phase === 'identify') { bw.classList.add('indet'); }
  if (p.message && (p.phase !== 'scan' || p.done === 0 || p.done === p.total || p.done % 128 === 0)) plog(p.message, p.phase === 'found');
});

const foundEl = $('#found');
function addFound(d) {
  const b = h('button', { class: 'btn', onclick: () => connect(d.host, d.port) },
    h('span', {}, h('b', { text: d.name || d.host }), h('div', { class: 'muted', text: `${d.host}${d.port ? ":" + d.port : ""}${d.port === 60128 ? " · eISCP" : ""} · ${d.source}` })), h('span', { class: 'badge ok', text: 'Se connecter' }));
  foundEl.append(h('li', {}, b));
}
async function connect(host, port) {
  setMsg(`Connexion à ${host}…`);
  try { await App.api('/api/connect', { host, port }); } catch (e) { setMsg(e.message, true); }
}
$('#btnDiscover').onclick = async () => {
  const btn = $('#btnDiscover');
  btn.disabled = true; btn.textContent = 'Recherche en cours…';
  foundEl.innerHTML = ''; logEl.innerHTML = ''; $('#progressBar').style.width = '0';
  $('#progressWrap').hidden = false; $('#progressWrap .bar').classList.add('indet');
  setMsg('');
  try {
    const { found } = await App.api('/api/discover');
    $('#progressWrap .bar').classList.remove('indet'); $('#progressBar').style.width = '100%';
    if (!found.length) { setMsg("Aucun récepteur trouvé. Vérifie qu'il est allumé (réseau activé) et sur le même réseau, ou saisis son IP.", true); plog('Terminé : aucun résultat'); }
    else { plog(`Terminé : ${found.length} récepteur(s)`, true); found.forEach(addFound); if (found.length === 1) connect(found[0].host, found[0].port); }
  } catch (e) { setMsg(e.message, true); }
  btn.disabled = false; btn.textContent = 'Rechercher le récepteur';
};
// Récepteurs déjà utilisés (sur cet appareil) : reconnexion en un geste, pratique avec plusieurs amplis
const recentEl = h('ul', { class: 'found' });
foundEl.before(recentEl);
function showRecent() {
  const list = store.get('recentAvrs', []);
  recentEl.innerHTML = '';
  if (!list.length) return;
  recentEl.append(h('li', { class: 'muted', style: 'font-size:12px', text: 'Récepteurs déjà utilisés' }));
  for (const d of list) {
    const forget = h('button', { class: 'btn small', type: 'button', text: '✕', style: 'width:auto;flex:none;padding:10px 12px', title: 'Oublier', 'aria-label': 'Oublier',
      onclick: (e) => { e.stopPropagation(); store.set('recentAvrs', store.get('recentAvrs', []).filter((x) => x.host !== d.host)); showRecent(); } });
    recentEl.append(h('li', { style: 'display:flex;gap:6px;align-items:center' },
      h('button', { class: 'btn', style: 'flex:1', onclick: () => connect(d.host, d.port) },
        h('span', {}, h('b', { text: d.name || (d.model ? `Pioneer ${d.model}` : d.host) }), h('div', { class: 'muted', text: `${d.host}${d.port ? ':' + d.port : ''}${d.port === 60128 ? ' · eISCP' : ''}` })),
        h('span', { class: 'badge ok', text: 'Se connecter' })), forget));
  }
}
var recentKey = '';   // var : render() peut l'appeler avant cette ligne
function rememberAvr() {
  const s = App.state;
  if (App.status !== 'connected' || App.demo || !App.host || !s?.model) return;
  const d = { host: App.host, port: App.port || null, model: s.model, name: s.friendlyName || '' };
  const key = JSON.stringify(d);
  if (key === recentKey) return;
  recentKey = key;
  store.set('recentAvrs', [d, ...store.get('recentAvrs', []).filter((x) => x.host !== d.host)].slice(0, 6));
}
App.on('status', (d) => { if (d.status !== 'connected') showRecent(); });
showRecent();
$('#manualForm').onsubmit =(e) => { e.preventDefault(); const v = $('#manualHost').value.trim(); if (v) connect(v); };
const startDemo = (profile) => { setMsg('Démarrage de la démo…'); App.api('/api/demo', { on: true, profile }).catch((e) => setMsg(e.message, true)); };
// Choix du modèle simulé et de la langue : sur l'écran de connexion et dans le bandeau démo
const demoPick = DemoModelSelect({ style: 'width:100%' });
$('#demoPick').append(demoPick);
$('#btnDemo').onclick = () => startDemo(demoPick.value);
$('#demoTools').append(DemoModelSelect({ class: 'small' }), LangSelect({ class: 'small' }));
$('#connLang').append(LangSelect({ class: 'small', style: 'width:auto' }));

/* --- raccourcis clavier --- */
const SHORTCUTS = [['↑ / ↓', 'Volume +1 / −1 dB'], ['M', 'Mute'], ['P', 'Alimentation'], ['1 – 9', 'Changer d\'écran'], ['?', 'Afficher cette aide']];
function showShortcuts() {
  const d = $('#dlg'); d.innerHTML = '';
  d.append(h('h3', { text: 'Raccourcis clavier' }),
    h('dl', { class: 'kbd-list' }, SHORTCUTS.flatMap(([k, t]) => [h('dt', {}, k.split(' / ').flatMap((x, i) => [i ? ' ' : '', h('kbd', { text: x })])), h('dd', { style: 'margin:0', text: t })])),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', text: 'Fermer', onclick: () => d.close() })));
  d.onclose = null; d.showModal();
}
window.showShortcuts = showShortcuts;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target, typing = t.matches?.('input:not([type=range]), textarea, select, [contenteditable]');
  if (typing || $('#dlg').open || App.status !== 'connected') return;
  if (e.key === 'ArrowUp') { e.preventDefault(); App.cmd('volumeUp'); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); App.cmd('volumeDown'); }
  else if (e.key === 'm' || e.key === 'M') App.cmd(App.state?.mute ? 'muteOff' : 'muteOn');
  else if (e.key === 'p' || e.key === 'P') App.cmd(App.state?.power ? 'powerOff' : 'powerOn');
  else if (e.key === '?') showShortcuts();
  else if (/^[1-9]$/.test(e.key)) {
    // Même ordre que le menu, sans les écrans que ce modèle n'a pas
    const shown = ORDER.filter((id) => !App.views[id].available || !App.state || App.views[id].available(App.state));
    if (shown[+e.key - 1]) App.show(shown[+e.key - 1]);
  }
});

/* --- APK : les boutons de volume du téléphone pilotent l'ampli (option des Réglages) --- */
function syncVolumeKeys() { window.PIONEER_NATIVE?.setVolumeKeys?.(!!store.get('volumeKeys', false) && App.status === 'connected'); }
App.on('status', syncVolumeKeys);
window.syncVolumeKeys = syncVolumeKeys;
window.addEventListener('pioneerVolumeKey', (e) => { if (App.status === 'connected') App.cmd(e.dir === 'up' ? 'volumeUp' : 'volumeDown'); });

connectSSE();
App.show(store.get('view', 'home') in App.views ? store.get('view', 'home') : 'home');
window.syncThemeIcon = syncThemeIcon;

I18N.init();
