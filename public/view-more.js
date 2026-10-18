'use strict';
// Vues : Presets, Terminal, Réglages. + applyPreset (global, utilisé aussi par l'Accueil).

const FIELD_LABELS = {
  input: 'Entrée', mode: 'Mode d\'écoute', spk: 'Système d\'enceintes', params: 'Précision audio', levels: 'Niveaux des enceintes',
  eq: 'Égaliseur', tone: 'Tonalité (on/off)', bass: 'Graves', treble: 'Aigus', volume: 'Volume', mute: 'Mute', z2: 'Zone 2', tunerPreset: 'Station radio',
};

function describePreset(p) {
  const d = p.data, out = [];
  if (d.input) out.push(App.inputName(d.input));
  if (d.mode) out.push(App.modeName(d.mode));
  if (d.volume !== undefined) out.push(App.volText(d.volume));
  if (d.spk !== undefined) out.push(`SPK ${d.spk}`);
  if (d.levels) out.push('Niveaux'); if (d.eq) out.push('EQ'); if (d.params) out.push('Précision');
  if (d.tone !== undefined) out.push(d.tone ? 'Tonalité on' : 'Tonalité off');
  if (d.z2) out.push('Zone 2'); if (d.tunerPreset) out.push(`Radio ${d.tunerPreset}`); if (d.mute !== undefined) out.push(d.mute ? 'Mute' : 'Son');
  return out;
}

async function applyPreset(p) {
  const cur = App.state?.volume;
  if (p.data.volume !== undefined && cur != null && p.data.volume - cur > 20) {
    if (!(await confirmDialog(`Appliquer « ${p.name} » ?`, `Le volume passera de ${App.volText(cur)} à ${App.volText(p.data.volume)} (+${((p.data.volume - cur) / 2).toFixed(0)} dB).`))) return;
  }
  try { const r = await App.api(`/api/presets/${encodeURIComponent(p.id)}/apply`); App.toast(`« ${p.name} » appliqué (${r.sent.length} commandes)`); } catch { /* toast déjà affiché */ }
}

function presetDialog(existing) {
  const d = $('#dlg');
  const s = App.state || {};
  const avail = {
    input: !!s.input, mode: !!s.mode, spk: s.spk != null, params: Object.keys(s.params || {}).length > 0, levels: !!s.levels, eq: !!s.eq,
    tone: s.tone != null, bass: s.bass != null, treble: s.treble != null, volume: s.volume != null, mute: s.mute != null, z2: s.z2?.power != null, tunerPreset: !!s.tuner?.preset,
  };
  const defaults = new Set(['input', 'mode', 'spk', 'params', 'levels', 'eq', 'tone', 'bass', 'treble']);
  const name = h('input', { placeholder: 'ex. Film, Musique, Nuit…', maxlength: 40, value: existing?.name || '' });
  const checks = {};
  const rows = Object.entries(FIELD_LABELS).map(([f, label]) => {
    const cb = h('input', { type: 'checkbox', checked: defaults.has(f) && avail[f], disabled: !avail[f] }); checks[f] = cb;
    let detail = '';
    if (avail[f]) {
      if (f === 'input') detail = App.inputName(s.input); else if (f === 'mode') detail = App.modeName(s.mode); else if (f === 'volume') detail = App.volText(s.volume);
      else if (f === 'bass' || f === 'treble') detail = `${s[f] > 0 ? '+' : ''}${s[f]} dB`; else if (f === 'tunerPreset') detail = s.tuner.preset;
    }
    return h('label', { class: 'check' }, cb, h('span', {}, label, detail ? h('small', { class: 'muted', text: ` · ${detail}` }) : null), !avail[f] ? h('small', { class: 'muted', text: ' (indisponible)' }) : null);
  });
  d.innerHTML = '';
  d.append(h('h3', { text: existing ? `Modifier « ${existing.name} »` : 'Nouveau preset' }),
    h('p', { class: 'muted', style: 'margin-top:0', text: existing ? 'Renomme, ou recapture l\'état actuel avec les cases cochées.' : 'Capture l\'état actuel du récepteur. Coche ce que le preset doit restaurer.' }),
    h('label', { class: 'stack' }, h('span', { class: 'muted', text: 'Nom' }), name), h('div', { style: 'margin-top:10px' }, rows),
    h('p', { class: 'muted', style: 'font-size:12px', text: 'Le volume n\'est pas coché par défaut ; il est plafonné par la limite de sécurité.' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', text: 'Annuler', onclick: () => d.close() }),
      existing ? h('button', { class: 'btn', text: 'Renommer seulement', onclick: async () => { await App.api('/api/presets', { id: existing.id, name: name.value }); d.close(); } }) : null,
      h('button', { class: 'btn primary', text: existing ? 'Recapturer' : 'Créer', onclick: async () => {
        if (!name.value.trim()) { name.focus(); return; }
        const fields = Object.keys(checks).filter((f) => checks[f].checked);
        if (!fields.length) { App.toast('Coche au moins un réglage', true); return; }
        await App.api('/api/presets', { id: existing?.id, name: name.value, fields }); d.close(); App.toast('Preset enregistré');
      } })));
  d.showModal(); name.focus();
}

(function presets() {
  const el = h('section', { class: 'view', 'data-view': 'presets' });
  const grid = h('div', { class: 'grid g3' });
  el.append(h('div', { class: 'row between', style: 'margin-bottom:16px' }, h('div', {}, h('h1', { text: 'Presets', style: 'font-size:22px' }), h('div', { class: 'muted', text: 'Des ambiances en un clic : entrée, mode, niveaux, égaliseur…' })),
    h('button', { class: 'btn primary', text: '+ Nouveau depuis l\'état actuel', onclick: () => presetDialog() })), grid);
  function render() {
    grid.innerHTML = '';
    if (!App.meta.presets.length) grid.append(h('div', { class: 'card', style: 'grid-column:1/-1;text-align:center' }, h('p', { class: 'muted', text: 'Aucun preset pour l\'instant. Règle ton récepteur comme tu veux, puis clique « Nouveau ».' })));
    for (const p of App.meta.presets) {
      grid.append(h('div', { class: 'card preset' },
        h('header', {}, h('h3', { text: p.name }), h('div', { class: 'row', style: 'gap:4px' },
          h('button', { class: 'icon-btn', style: 'width:34px;height:34px', html: icon('settings'), title: 'Modifier', 'aria-label': 'Modifier', onclick: () => presetDialog(p) }),
          h('button', { class: 'icon-btn', style: 'width:34px;height:34px', html: icon('trash'), title: 'Supprimer', 'aria-label': 'Supprimer', onclick: async () => { if (await confirmDialog(`Supprimer « ${p.name} » ?`, 'Cette action est définitive.')) App.api(`/api/presets/${encodeURIComponent(p.id)}`, {}, 'DELETE'); } }))),
        h('div', { class: 'chips' }, describePreset(p).map((t) => h('span', { class: 'badge', text: t }))),
        h('button', { class: 'btn primary', text: 'Appliquer', onclick: () => applyPreset(p) })));
    }
  }
  App.on('presets', () => { if (App.current === 'presets') render(); });
  App.on('meta', () => render());
  App.register('presets', { el, update: () => {}, onShow: render, title: 'Presets', icon: 'star' });
})();

(function terminal() {
  const el = h('section', { class: 'view', 'data-view': 'terminal' });
  const log = h('pre', { id: 'log' }), input = h('input', { placeholder: 'Code brut : ?V   ·   050VL   ·   04FN   ·   ?ILV', autocomplete: 'off', spellcheck: 'false' });
  const history = []; let hi = 0;
  const add = (dir, text) => { const d = h('div', { class: dir }, `${dir === 'tx' ? '→' : '←'} ${text}`); log.append(d); while (log.childElementCount > 400) log.firstChild.remove(); if (App.current === 'terminal') log.scrollTop = log.scrollHeight; };
  App.on('log', (l) => add(l.dir, l.text));
  const form = h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; history.push(v); hi = history.length; App.send(v); input.value = ''; } }, input, h('button', { class: 'btn primary', text: 'Envoyer' }));
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' && hi > 0) { input.value = history[--hi]; e.preventDefault(); } if (e.key === 'ArrowDown') { input.value = history[++hi] || ''; hi = Math.min(hi, history.length); } });
  el.append(h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Terminal' }), h('button', { class: 'btn small', text: 'Effacer', onclick: () => (log.innerHTML = '') })), form, log,
    h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Format Pioneer : valeur AVANT le code pour écrire (050VL, 1IS, 040201SSC), « ? » pour lire (?V, ?IS).' })));
  App.register('terminal', { el, update: () => {}, onShow: () => { log.scrollTop = log.scrollHeight; }, title: 'Terminal', icon: 'terminal' });
})();

(function system() {
  const el = h('section', { class: 'view', 'data-view': 'system' });
  const info = h('div', { class: 'stack' });
  const maxIn = h('input', { type: 'range', min: 60, max: 185, value: 161 }); const maxTxt = h('b');
  const saveMax = debounce(() => App.api('/api/config', { maxVolume: +maxIn.value }).then(() => App.toast('Limite enregistrée')).catch(() => {}), 400);
  maxIn.addEventListener('input', () => { rangeFill(maxIn); maxTxt.textContent = App.volText(+maxIn.value); saveMax(); });
  const delayIn = h('input', { type: 'range', min: 30, max: 500, step: 10, value: 80, 'aria-label': 'Délai entre commandes' }); const delayTxt = h('b', { class: 'mono', text: '80 ms' });
  const saveDelay = debounce(() => App.api('/api/config', { commandDelay: +delayIn.value }).then(() => App.toast('Délai enregistré')).catch(() => {}), 400);
  delayIn.addEventListener('input', () => { rangeFill(delayIn); delayTxt.textContent = `${delayIn.value} ms`; saveDelay(); });
  const mkNum = (label, v, step) => h('input', { type: 'number', value: v, step, 'aria-label': label, title: label, style: 'width:90px' });
  const scMax = mkNum('Valeur maximale', 185, 1), scZero = mkNum('Valeur de 0 dB', 161, 1), scStep = mkNum('dB par pas', 0.5, 0.1);
  const applyScale = () => App.api('/api/config', { volumeScale: { max: +scMax.value, zero: +scZero.value, step: +scStep.value } }).then(() => App.toast('Échelle de volume enregistrée')).catch(() => {});
  const theme = h('div', { class: 'seg' }, [['auto', 'Auto'], ['dark', 'Sombre'], ['light', 'Clair']].map(([v, l]) => h('button', { 'data-v': v, text: l, onclick: () => { store.set('theme', v); applyTheme(); refreshTheme(); window.syncThemeIcon?.(); } })));
  const langSel = LangSelect();
  const refreshTheme = () => $$('button', theme).forEach((b) => b.classList.toggle('active', b.dataset.v === store.get('theme', 'dark')));
  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Récepteur' })), info,
      h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Rafraîchir l\'état', onclick: () => App.api('/api/connect', { host: App.host }).catch(() => {}) }), h('button', { class: 'btn danger', text: 'Changer de récepteur', onclick: () => App.api('/api/disconnect') }))),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Sécurité volume' }), maxTxt), maxIn,
        h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'Le serveur refuse tout volume au-dessus de cette limite (cadran, presets, terminal). 0 dB = réf 161.' })),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Compatibilité' }), h('span', { class: 'badge', text: 'autres modèles' })),
        h('div', { class: 'stack' }, h('div', { class: 'row between' }, 'Délai entre commandes', delayTxt), delayIn,
          h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Augmente-le si ton ampli ignore des commandes (certains modèles exigent plus de 100 ms)." })),
        h('div', { class: 'stack' }, h('div', { class: 'row between' }, 'Échelle de volume', h('button', { class: 'btn small', type: 'button', text: 'Standard Pioneer', onclick: () => App.api('/api/config', { volumeScale: { max: 185, zero: 161, step: 0.5 } }).then(() => App.toast('Échelle standard rétablie')).catch(() => {}) })),
          h('div', { class: 'row' }, scMax, scZero, scStep, h('button', { class: 'btn small', type: 'button', text: 'Appliquer', onclick: applyScale })),
          h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Valeur max de la commande de volume, valeur correspondant à 0 dB, et dB par pas. Standard : 185 · 161 · 0,5 (VSX récents)." }))),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Langue / Language' })), langSel),
      window.PIONEER_NATIVE?.native ? (() => {
        const cb = h('input', { type: 'checkbox', checked: !!store.get('volumeKeys', false), 'aria-label': 'Boutons de volume du téléphone', onchange: () => { store.set('volumeKeys', cb.checked); window.syncVolumeKeys?.(); } });
        return h('div', { class: 'card' }, h('div', { class: 'param' }, h('div', {}, 'Boutons de volume du téléphone', h('small', { text: "Quand l'appli est ouverte et l'ampli connecté, ils règlent le volume de l'ampli." })), h('label', { class: 'switch' }, cb, h('i'))));
      })() : null,
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Sauvegarde' })),
        h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Exporte tes presets et réglages, ou transfère-les entre le PC et le téléphone.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Sauvegarder / restaurer…', onclick: () => backupDialog() }))),
      AboutCard(),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Apparence' })), theme),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Mode démo' }), h('span', { class: 'badge', id: 'demoBadge' })),
        h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Un récepteur simulé pour essayer l\'appli sans matériel : entrées, modes, enceintes et réglages réagissent comme sur un VSX.' }),
        h('label', { class: 'stack' }, h('span', { class: 'muted', text: 'Modèle simulé' }), DemoModelSelect()),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'demoToggle', onclick: () => App.api('/api/demo', { on: !App.demo, profile: store.get('demoProfile', 'fy11') }) }), h('button', { class: 'btn', text: 'Raccourcis clavier', onclick: () => window.showShortcuts() }))),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Noms de modes appris' }), h('button', { class: 'btn small', text: 'Oublier', onclick: () => { App.learned = {}; store.set('learnedModes', {}); App.render(); } })),
        h('div', { class: 'chips' }, h('span', { class: 'muted', id: 'learnedList' }))))));
  const row = (k, v) => h('div', { class: 'param' }, h('span', { class: 'muted', text: k }), h('b', { class: 'mono', text: v }));
  let infoKey = '';
  function update(s) {
    const rows = [['Modèle', s.model || '—'], ['Version', s.firmware || '—'], ['Adresse', `${App.host || '—'}`], ['État', App.status === 'connected' ? 'Connecté' : App.status === 'connecting' ? 'Connexion…' : 'Non connecté'], ['Entrée', App.inputName(s.input)], ['Mode', `${s.mode || '—'} · ${App.modeName(s.mode)}`], ['Entrées détectées', String(App.inputIds().length)], ['Mémoires radio nommées', String(Object.values(s.tuner.names).filter(Boolean).length)]];
    const ik = JSON.stringify(rows);
    if (ik !== infoKey) { infoKey = ik; info.innerHTML = ''; info.append(...rows.map(([k, v]) => row(k, v))); }
    delayIn.value = App.meta.commandDelay || 80; rangeFill(delayIn); delayTxt.textContent = `${delayIn.value} ms`;
    if (document.activeElement !== scMax && document.activeElement !== scZero && document.activeElement !== scStep) { const sc = App.volScale(); scMax.value = sc.max; scZero.value = sc.zero; scStep.value = sc.step; }
    maxIn.value = App.meta.maxVolume; rangeFill(maxIn); maxTxt.textContent = App.volText(App.meta.maxVolume);
    $('#learnedList', el).textContent = Object.keys(App.learned).length ? Object.entries(App.learned).map(([k, v]) => `${k} → ${v}`).join('  ·  ') : 'Aucun pour l\'instant';
    refreshTheme();
    $('#demoToggle', el).textContent = App.demo ? 'Quitter la démo' : 'Lancer la démo';
    $('#demoBadge', el).textContent = App.demo ? 'actif' : 'inactif';
  }
  App.register('system', { el, update, title: 'Réglages', icon: 'settings' });
})();

/* ---------- Sauvegarde : presets, réglages de sécurité et préférences de l'appli dans un seul texte JSON ---------- */
const LOCAL_KEYS = ['layout', 'hiddenInputs', 'learnedModes', 'avail', 'theme', 'radioClass', 'volumeKeys', 'lang'];
function backupText() {
  const local = {};
  for (const k of LOCAL_KEYS) { const v = store.get(k); if (v !== undefined) local[k] = v; }
  const m = App.meta;
  return JSON.stringify({ app: 'pioneer-remote', version: 1, date: new Date().toISOString(), presets: m.presets.map(({ name, data }) => ({ name, data })),
    config: { maxVolume: m.maxVolume, commandDelay: m.commandDelay, volumeScale: m.volumeScale }, local }, null, 1);
}
async function restoreBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { App.toast('Ce texte n\'est pas une sauvegarde valide (JSON illisible)', true); return false; }
  if (!b || b.app !== 'pioneer-remote') { App.toast('Ce texte n\'est pas une sauvegarde Pioneer Remote', true); return false; }
  const ok = await confirmDialog('Restaurer cette sauvegarde ?', `${(b.presets || []).length} preset(s) ; les presets de même nom seront remplacés. La limite de volume et les préférences seront aussi restaurées.`);
  if (!ok) return false;
  try {
    if (Array.isArray(b.presets) && b.presets.length) await App.api('/api/presets/import', { presets: b.presets });
    const c = b.config || {}, next = {};
    if (Number.isInteger(c.maxVolume)) next.maxVolume = c.maxVolume;
    if (Number.isInteger(c.commandDelay)) next.commandDelay = c.commandDelay;
    if (c.volumeScale) next.volumeScale = c.volumeScale;
    if (Object.keys(next).length) await App.api('/api/config', next);
  } catch { return false; }
  for (const k of LOCAL_KEYS) if (b.local && b.local[k] !== undefined && k !== 'lang') store.set(k, b.local[k]);
  App.learned = store.get('learnedModes', {}) || {};
  applyTheme(); window.syncThemeIcon?.(); window.syncVolumeKeys?.();
  if (b.local?.lang && I18N.LANGS[b.local.lang]) I18N.set(b.local.lang);
  App.toast('Sauvegarde restaurée');
  App.render();
  return true;
}
function backupDialog() {
  const d = $('#dlg'); d.innerHTML = '';
  const area = h('textarea', { rows: 8, spellcheck: 'false', 'aria-label': 'Sauvegarde (JSON)', style: 'width:100%;font:12px ui-monospace,monospace' });
  area.value = backupText();
  const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    area.value = await f.text(); file.value = '';
  } });
  const native = !!window.PIONEER_NATIVE?.native;
  d.append(h('h3', { text: 'Sauvegarde et restauration' }),
    h('p', { class: 'muted', style: 'margin-top:0', text: 'Ce texte contient tes presets, la limite de volume et tes préférences. Copie-le pour le garder, ou colle ici une sauvegarde (du PC ou du téléphone) puis « Restaurer ».' }),
    area, file,
    h('div', { class: 'actions', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn', type: 'button', text: 'Copier', onclick: async () => {
        try { await navigator.clipboard.writeText(area.value); App.toast('Sauvegarde copiée'); } catch { area.select(); document.execCommand?.('copy'); App.toast('Sauvegarde copiée'); }
      } }),
      native ? null : h('button', { class: 'btn', type: 'button', text: 'Télécharger', onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([area.value], { type: 'application/json' })), download: `pioneer-remote-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
      } }),
      h('button', { class: 'btn', type: 'button', text: 'Ouvrir un fichier', onclick: () => file.click() }),
      h('button', { class: 'btn', type: 'button', text: 'Fermer', onclick: () => d.close() }),
      h('button', { class: 'btn primary', type: 'button', text: 'Restaurer', onclick: async () => { const text = area.value; d.close(); await restoreBackup(text); } })));
  d.onclose = null; d.showModal();
}

function applyTheme() {
  const t = store.get('theme', 'dark');
  const light = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}
