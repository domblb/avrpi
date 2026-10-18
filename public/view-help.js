'use strict';
// Vue : Aide — glossaire (modes d'écoute, son, entrées, connexion) et explication de chaque réglage de l'ampli.

(function help() {
  const el = h('section', { class: 'view', 'data-view': 'help' });
  const search = h('input', { placeholder: 'Chercher une fonction (ex. dialogue, phase, HDMI)…', 'aria-label': 'Chercher dans l\'aide' });
  const out = h('div', { class: 'stack' });
  let built = '';

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function build() {
    const q = norm(search.value.trim());
    out.innerHTML = '';
    const match = (...t) => !q || norm(t.join(' ')).includes(q);

    for (const g of App.meta.glossary || []) {
      const items = g.items.filter(([t, d]) => match(t, d));
      if (!items.length) continue;
      out.append(h('div', { class: 'card' }, h('header', {}, h('h2', { text: g.title })),
        h('dl', { class: 'gloss' }, items.flatMap(([t, d]) => [h('dt', { text: t }), h('dd', { text: d })]))));
    }

    // Réglages : regroupés comme dans l'onglet Son/Installation ; seuls ceux que l'ampli a répondus sont signalés
    const GROUPS = { dialogue: 'Dialogue, dynamique, LFE', espace: 'Espace & effets', synchro: 'Synchro & phase', correction: 'Correction de salle', signal: "Signal d'entrée",
      enceintes: 'Enceintes', installation: 'Installation', hdmi: 'HDMI', gestion: "Gestion de l'ampli" };
    for (const [grp, title] of Object.entries(GROUPS)) {
      const codes = Object.entries(App.meta.params || {}).filter(([, d]) => d.group === grp && d.help && match(d.label, d.help, d.hint || ''));
      if (!codes.length) continue;
      out.append(h('div', { class: 'card' }, h('header', {}, h('h2', { text: title }), h('span', { class: 'badge', text: `${codes.length}` })),
        h('dl', { class: 'gloss' }, codes.flatMap(([code, d]) => [
          h('dt', {}, d.label, ' ', h('span', { class: 'badge mono', text: code })),
          h('dd', { text: d.help.startsWith(`${d.label} : `) ? d.help.slice(d.label.length + 3) : d.help })]))));
    }
    const vh = Object.entries(App.meta.videoHelp || {}).filter(([k, t]) => match(t));
    if (vh.length) out.append(h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Vidéo' })),
      h('dl', { class: 'gloss' }, vh.flatMap(([k, t]) => { const i = t.indexOf(' : '); return [h('dt', { text: i > 0 ? t.slice(0, i) : `VT${k}` }), h('dd', { text: i > 0 ? t.slice(i + 3) : t })]; }))));
    if (!out.children.length) out.append(h('p', { class: 'muted', text: 'Aucun résultat.' }));
  }

  search.addEventListener('input', () => { built = ''; build(); });
  el.append(h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('header', {}, h('h2', { text: 'Aide' })),
    h('p', { class: 'muted', style: 'margin:0 0 8px;font-size:13px', text: "Explications des fonctions de l'ampli. Dans l'appli, le petit « i » à côté d'un réglage affiche aussi son aide." }), search), out);

  function update() {
    const key = `${Object.keys(App.meta.params || {}).length}|${(App.meta.glossary || []).length}`;
    if (key !== built && !search.value) { built = key; build(); }
  }
  App.register('help', { el, update, onShow: () => { if (!out.children.length) build(); }, title: 'Aide', icon: 'help' });
})();
