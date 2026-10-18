'use strict';
// Écran Installation : calibration (enceintes, MCACC), HDMI, gestion de l'ampli, entrées, informations.
// Tout est détecté : une ligne n'apparaît que si l'ampli a répondu à sa requête.
(function install() {
  const el = h('section', { class: 'view', 'data-view': 'install' });

  /* --- groupes de réglages (générés depuis la liste des paramètres) --- */
  const GROUPS = [
    ['installation', 'Enceintes & calibration', "Ces réglages modifient la calibration : ils demandent une confirmation."],
    ['hdmi', 'HDMI', null],
    ['gestion', "Gestion de l'ampli", null],
  ];
  function GroupCard(group, title, note) {
    const codes = Object.keys(App.meta.params).filter((c) => App.meta.params[c].group === group);
    const rows = codes.map((c) => ParamRow(c));
    const card = h('div', { class: 'card' }, h('header', {}, h('h2', { text: title })), note ? h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: note }) : null, h('div', {}, rows.map((r) => r.el)));
    return { el: card, update(s) { rows.forEach((r) => r.update(s)); card.hidden = rows.every((r) => r.el.hidden); } };
  }

  /* --- tableaux de lecture : tailles d'enceintes, niveaux MCACC, distances --- */
  const SIZE = { 0: 'Petite', 1: 'Grande', 2: 'Aucune' };
  const BACK = { 0: 'Petites ×2', 1: 'Grande ×1', 2: 'Grandes ×2', 3: 'Aucune', 4: 'Petite ×1' };
  const SUB = { 0: 'Oui', 1: 'Plus', 2: 'Non' };
  const speakerText = (id, v) => (id === '05' ? BACK[v] : id === '06' ? SUB[v] : SIZE[v]) ?? `valeur ${v}`;
  const distText = (raw) => {
    if (!raw) return '—';
    if (raw[0] === '1') return `${(parseInt(raw.slice(1), 10) / 100).toFixed(2)} m`;
    return `${+raw.slice(1, 3)}'${+raw.slice(3, 5)}"`;
  };
  const tables = h('div', { class: 'stack' });
  function buildTables(s) {
    tables.innerHTML = '';
    const sp = Object.entries(s.speakerSetup || {});
    if (sp.length) {
      tables.append(h('div', { class: 'muted', style: 'font-size:12px', text: 'TAILLE DES ENCEINTES (lecture)' }),
        h('div', { class: 'chips' }, sp.map(([id, v]) => h('span', { class: 'badge', text: `n°${id} · ${speakerText(id, v)}` }))));
    }
    for (const [mem, chans] of Object.entries(s.mcacc || {})) {
      tables.append(h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: `NIVEAUX MCACC · mémoire M${+mem}` }),
        h('div', { class: 'chips' }, Object.entries(chans).map(([c, v]) => h('span', { class: 'badge mono', text: `${App.meta.channelNames[c] || c} ${v > 0 ? '+' : ''}${v.toFixed(1)} dB` }))));
    }
    for (const [mem, chans] of Object.entries(s.distances || {})) {
      tables.append(h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: `DISTANCES · mémoire M${+mem}` }),
        h('div', { class: 'chips' }, Object.entries(chans).map(([c, v]) => h('span', { class: 'badge mono', text: `${App.meta.channelNames[c] || c} ${distText(v)}` }))));
    }
    if (!tables.children.length) tables.append(h('p', { class: 'muted', style: 'margin:0', text: "Cet ampli ne détaille pas sa calibration par le réseau." }));
  }
  const tablesCard = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Calibration mesurée' })), tables);

  /* --- entrées : renommer, masquer --- */
  const inputsBox = h('div'); let inputsKey = '';
  async function rename(id) {
    const d = $('#dlg'); d.innerHTML = '';
    const input = h('input', { value: App.state.names[id] || '', maxlength: 14, 'aria-label': "Nouveau nom de l'entrée", autocomplete: 'off' });
    const go = async () => {
      const name = input.value.trim(); d.close();
      if (!name) return;
      try { await App.api('/api/rename', { id, name }); } catch { return; }
      setTimeout(() => { if (App.state.names[id] !== name) App.problem({ sev: 'major', title: "L'ampli n'a pas accepté ce nom (14 caractères ASCII max, ou fonction absente)", raw: `entrée ${id}` }); else App.toast('Entrée renommée'); }, 1500);
    };
    d.append(h('h3', { text: `Renommer l'entrée ${id}` }), h('p', { class: 'muted', style: 'margin-top:0', text: "14 caractères maximum. Le nom est enregistré dans l'ampli." }), input,
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Annuler', onclick: () => d.close() }), h('button', { class: 'btn primary', text: 'Renommer', onclick: go })));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    d.onclose = null; d.showModal(); input.select();
  }
  function buildInputs(s) {
    const ids = Object.keys(s.names).filter((k) => s.names[k]).sort();
    const hidden = new Set(App.hiddenInputs());
    // eISCP : noms lus dans la fiche de l'ampli, pas de renommage par le réseau
    const legacy = s.protocol !== 'eiscp';
    const key = legacy + ids.map((i) => `${i}:${s.names[i]}:${hidden.has(i) ? 1 : 0}`).join('|');
    if (key === inputsKey) return;
    inputsKey = key; inputsBox.innerHTML = '';
    for (const id of ids) {
      const hid = hidden.has(id);
      inputsBox.append(h('div', { class: 'param' },
        h('div', {}, h('span', { class: hid ? 'muted' : '', text: s.names[id] }), h('small', { text: `n°${id}${legacy && s.names[id] !== App.meta.inputs[id] && App.meta.inputs[id] ? ` · d'origine : ${App.meta.inputs[id]}` : ''}` })),
        h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn small', type: 'button', text: hid ? 'Afficher' : 'Masquer', title: "Masquer l'entrée dans l'appli (l'ampli n'est pas modifié)", onclick: () => {
            const set = new Set(App.hiddenInputs()); if (set.has(id)) set.delete(id); else set.add(id); store.set('hiddenInputs', [...set]); inputsKey = ''; App.render();
          } }),
          legacy ? h('button', { class: 'btn small', type: 'button', text: 'Renommer', onclick: () => rename(id) }) : null,
          legacy ? h('button', { class: 'btn small', type: 'button', text: 'Par défaut', onclick: () => App.api('/api/rename', { id, reset: true }).catch(() => {}) }) : null)));
    }
    if (!ids.length) inputsBox.append(h('p', { class: 'muted', text: "Aucune entrée n'a répondu." }));
  }

  /* --- informations du récepteur --- */
  const infoBox = h('div');
  const infoRow = (k, v) => h('div', { class: 'param' }, h('span', { class: 'muted', text: k }), h('b', { class: 'mono', text: v || '—' }));
  const groupCards = lazy(() => {
    const cards = GROUPS.map(([g, t, n]) => GroupCard(g, t, n));
    const box = h('div', { class: 'stack' }, cards.map((c) => c.el));
    return { el: box, update(s) { cards.forEach((c) => c.update(s)); } };
  });

  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'stack' }, groupCards.el, tablesCard),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Récepteur' })), infoBox),
      h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Entrées' })), inputsBox,
        h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Masquer une entrée la retire de l'appli seulement. Renommer l'écrit dans l'ampli (comme sur sa face avant)." })))));

  let tablesKey = '', infoKey = '';
  function update(s) {
    groupCards.update(s);
    const tk = JSON.stringify([s.speakerSetup, s.mcacc, s.distances]);
    if (tk !== tablesKey) { tablesKey = tk; buildTables(s); }
    buildInputs(s);
    const ik = [s.model, s.friendlyName, s.firmware, s.mac, App.host].join('|');
    if (ik === infoKey) return;
    infoKey = ik; infoBox.innerHTML = '';
    infoBox.append(infoRow('Modèle', s.model), infoRow('Nom réseau', s.friendlyName), infoRow('Version', s.firmware), infoRow('Adresse MAC', s.mac), infoRow('Adresse IP', App.host));
  }
  App.register('install', { el, update, title: 'Installation', icon: 'tool' });
})();
