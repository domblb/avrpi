'use strict';
// Carte « Emphase » : mettre le dialogue ou les graves en avant.
//   Dialogue : Dialog Enhancement (ATH) + niveau du canal centre (ILV)
//   Graves   : niveau du caisson (ILV) + graves de la tonalité (BA) + atténuateur LFE (ATM)
function EmphasisCard() {
  const chIdx = (c) => App.meta.channels.indexOf(c);
  const levelsNow = () => [...(App.state?.levels || Array(17).fill(50))];
  const dbText = (v) => `${(v - 50) / 2 > 0 ? '+' : ''}${((v - 50) / 2).toFixed(1)} dB`;

  // Écrit les niveaux (ILV) en ne touchant qu'aux canaux demandés.
  function setLevels(changes) {
    const l = levelsNow();
    for (const [c, v] of Object.entries(changes)) l[chIdx(c)] = clamp(Math.round(v), 26, 74);
    App.state.levels = l; App.markWrite();
    return App.api('/api/levels', { values: l }).catch(() => {});
  }

  // Curseur de niveau d'un canal (±12 dB, pas de 0,5 dB).
  function LevelSlider(chan, label, hint) {
    const r = h('input', { type: 'range', min: 26, max: 74, step: 1, value: 50, 'aria-label': label, style: 'flex:1;min-width:110px' });
    const val = h('b', { class: 'mono', style: 'min-width:64px;text-align:right' });
    let drag = false;
    const send = throttle((v) => setLevels({ [chan]: v }), 140);
    r.addEventListener('input', () => { drag = true; rangeFill(r); val.textContent = dbText(+r.value); send(+r.value); });
    r.addEventListener('change', () => { drag = false; });
    const el = h('div', { class: 'param' }, h('div', {}, label, hint ? h('small', { text: hint }) : null),
      h('div', { class: 'row', style: 'flex:1;justify-content:flex-end;flex-wrap:nowrap' }, r, val));
    return { el, update(s) { const v = s.levels?.[chIdx(chan)]; el.hidden = v === undefined; if (v !== undefined && !drag) { r.value = v; rangeFill(r); val.textContent = dbText(v); } } };
  }

  // Graves de la tonalité (±6 dB), avec l'interrupteur de tonalité.
  function BassTone() {
    const sw = h('input', { type: 'checkbox', 'aria-label': 'Tonalité', onchange: () => App.cmd(sw.checked ? 'toneOn' : 'toneOff') });
    const r = h('input', { type: 'range', min: -6, max: 6, step: 1, value: 0, 'aria-label': 'Graves', style: 'flex:1;min-width:110px' });
    const val = h('b', { class: 'mono', style: 'min-width:64px;text-align:right' });
    let drag = false;
    const send = throttle((v) => App.cmd('bassSet', v), 140);
    r.addEventListener('input', () => { drag = true; rangeFill(r); val.textContent = `${r.value > 0 ? '+' : ''}${r.value} dB`; send(+r.value); });
    r.addEventListener('change', () => { drag = false; });
    const el = h('div', { class: 'param' }, h('div', {}, 'Graves (tonalité)', h('small', { text: 'Nécessite la tonalité activée (indisponible en mode Direct)' })),
      h('div', { class: 'row', style: 'flex:1;justify-content:flex-end;flex-wrap:nowrap' }, h('label', { class: 'switch' }, sw, h('i')), r, val));
    return { el, update(s) { el.hidden = s.bass == null; sw.checked = !!s.tone; if (!drag && s.bass != null) { r.value = s.bass; rangeFill(r); val.textContent = `${s.bass > 0 ? '+' : ''}${s.bass} dB`; } } };
  }

  const center = LevelSlider('C', 'Niveau du centre (voix)', 'Canal qui porte les dialogues');
  const sub = LevelSlider('SW', 'Niveau du caisson', 'Basses du caisson de graves');
  const ath = ParamRow('ATH', { compact: true });
  const lfe = ParamRow('ATM', { compact: true });
  const bass = BassTone();
  const parts = [ath, center, sub, bass, lfe];

  // Scènes rapides, relatives au réglage d'origine (le calibrage MCACC met souvent le centre ou le caisson
  // loin de 0 dB : constaté centre −12 dB sur un VSX-921). Ce réglage est mémorisé à la première scène
  // et « Neutre » le rétablit.
  const SCENES = [
    { id: 'neutre', label: 'Neutre' },
    { id: 'dialogue', label: 'Dialogue', ath: 3, up: { C: 6 } },
    { id: 'graves', label: 'Graves', up: { SW: 6 }, bass: 3, tone: true },
    { id: 'both', label: 'Dialogue + graves', ath: 3, up: { C: 6, SW: 6 }, bass: 3, tone: true },
  ];
  const baseKey = () => `emphBase:${App.state?.model || ''}`;
  async function apply(sc) {
    if (!App.state?.levels) { App.toast('Niveaux inconnus (interrogation en cours)', true); return; }
    const s = App.state;
    let base = store.get(baseKey(), null);
    if (sc.id === 'neutre') {
      if (!base) { App.toast(`Emphase : ${sc.label}`); return; }
      await setLevels({ C: base.C, SW: base.SW });
      // Tonalité coupée : l'ampli ignore les graves sans répondre
      if (base.bass != null && s.bass != null && s.tone && s.bass !== base.bass) await App.cmd('bassSet', base.bass);
      if (base.tone === false && s.tone) await App.cmd('toneOff');
      if (base.ath !== undefined && s.params?.ATH !== undefined && s.params.ATH !== base.ath) await App.set('ATH', base.ath);
      store.set(baseKey(), null);
      App.toast(`Emphase : ${sc.label}`);
      return;
    }
    if (!base) {
      base = { C: s.levels[chIdx('C')], SW: s.levels[chIdx('SW')], ath: s.params?.ATH, bass: s.bass, tone: !!s.tone };
      store.set(baseKey(), base);
    }
    sc = { ...sc, levels: Object.fromEntries(Object.entries(sc.up || {}).map(([c, d]) => [c, base[c] + d])) };
    // Le canal non concerné revient à son réglage d'origine (passage de « Graves » à « Dialogue »…)
    for (const c of ['C', 'SW']) if (!(c in sc.levels)) sc.levels[c] = base[c];
    if (sc.ath === undefined && base.ath !== undefined) sc.ath = base.ath;
    if (sc.bass === undefined && base.bass != null) sc.bass = base.bass;
    // Niveaux d'abord : après Dialog Enhancement, l'ampli ignore un moment les niveaux de canal
    if (sc.levels) await setLevels(sc.levels);
    if (sc.tone && !App.state.tone) await App.cmd('toneOn');
    if (sc.bass !== undefined && (App.state.tone || sc.tone)) await App.cmd('bassSet', sc.bass);
    // Modèles sans Up 1 à 4 (ex. VSX-921 : Off/Flat seulement) : on se contente de Flat
    if (sc.ath !== undefined && s.params?.ATH !== undefined) {
      const known = !App.unsupported('ATH').includes(sc.ath), want = known ? sc.ath : 1;
      if (s.params.ATH !== want) await App.set('ATH', want);
      // Première fois sur un tel modèle : l'option se révèle absente, on repasse en Flat
      if (known && sc.ath > 1) setTimeout(() => { if (App.unsupported('ATH').includes(sc.ath) && App.state.params.ATH !== 1) App.set('ATH', 1); }, 2600);
    }
    App.toast(`Emphase : ${sc.label}`);
  }
  const chips = h('div', { class: 'chips' }, SCENES.map((sc) => h('button', { class: 'chip', text: sc.label, onclick: () => apply(sc) })));

  const dlgLabel = h('div', { class: 'muted', style: 'font-size:12px;margin-top:2px', text: 'DIALOGUE' });
  const bassLabel = h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: 'GRAVES' });
  const note = h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Dialogue = Dialog Enhancement Up 2 (ou Flat) et centre +3 dB. Graves = caisson +3 dB et tonalité +3 dB, par rapport à ton réglage. « Neutre » rétablit le réglage d'avant." });
  const el = h('div', { class: 'card' },
    h('header', {}, h('h2', { text: 'Emphase' }), h('span', { class: 'badge', text: 'dialogue · graves' })),
    chips, dlgLabel, ath.el, center.el, bassLabel, sub.el, bass.el, lfe.el, note);
  // Selon l'ampli : scènes rapides seulement avec les niveaux de canaux ; carte masquée s'il n'y a rien à régler
  return { el, update(s) {
    parts.forEach((p) => p.update(s));
    chips.hidden = note.hidden = !s.levels;
    dlgLabel.hidden = ath.el.hidden && center.el.hidden;
    bassLabel.hidden = sub.el.hidden && bass.el.hidden && lfe.el.hidden;
    el.hidden = parts.every((p) => p.el.hidden);
  } };
}
