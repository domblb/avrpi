'use strict';
// Journal des erreurs et rapport de diagnostic. Logique pure (aucun DOM) : utilisée par l'interface et par les tests Node.
// Les textes sont en français ; l'interface les traduit à l'affichage (i18n.js), le rapport reste en français pour l'auteur.
const Diag = (() => {
  const MAX = 200, TRACE_MAX = 1500, SAME_MS = 3000;

  // Journal : entrées { t, sev: 'minor'|'major', title, advice, raw, n } (plus récentes en tête), persistant via load/save.
  function createJournal({ load = () => [], save = () => {}, now = Date.now } = {}) {
    const saved = load();
    let items = Array.isArray(saved) ? saved : [];
    let unread = items.filter((i) => !i.read).length;
    const subs = new Set();
    const changed = () => { save(items); for (const fn of subs) fn(); };
    return {
      add({ sev = 'minor', title, advice = '', raw = '' }) {
        if (!title) return;
        const t = now(), last = items[0];
        // La même erreur répétée (curseur qu'on fait glisser…) n'occupe qu'une ligne, avec un compteur.
        if (last && last.title === title && last.raw === raw && t - last.t < SAME_MS) { last.n = (last.n || 1) + 1; last.t = t; if (last.read) { last.read = false; unread++; } }
        else { items.unshift({ t, sev, title, advice, raw, n: 1 }); unread++; if (items.length > MAX) { const gone = items.splice(MAX); unread -= gone.filter((i) => !i.read).length; } }
        changed();
      },
      list: () => items,
      get unread() { return unread; },
      markRead() { if (!unread) return; items.forEach((i) => { i.read = true; }); unread = 0; changed(); },
      clear() { items = []; unread = 0; changed(); },
      on(fn) { subs.add(fn); return () => subs.delete(fn); },
    };
  }

  // Trace circulaire des trames échangées avec l'ampli (→ envoyée, ← reçue, · info).
  function createTrace(max = TRACE_MAX, now = Date.now) {
    const lines = [];
    return {
      push(dir, text) { lines.push({ t: now(), dir, text }); if (lines.length > max) lines.splice(0, lines.length - max); },
      lines: () => lines,
      clear() { lines.length = 0; },
    };
  }

  // Refus de l'ampli (réponse E0x / B00 à une commande) → entrée de journal compréhensible.
  function rejectedEntry({ cmd, code }, label) {
    const what = label || cmd, raw = `${cmd} → ${code}`;
    const report = 'Si ton ampli propose ce réglage dans son propre menu, envoie un rapport pour que l\'appli soit corrigée.';
    switch (code) {
      case 'E03': case 'E04':
        return { sev: 'minor', title: `« ${what} » : ton ampli ne connaît pas ce réglage`, advice: `C'est normal sur certains modèles. ${report}`, raw };
      case 'E02':
        return { sev: 'minor', title: `« ${what} » indisponible pour l'instant`, advice: "L'ampli est en veille, ou la source ou le mode d'écoute actuels ne le permettent pas.", raw };
      case 'E06':
        return { sev: 'minor', title: `« ${what} » : valeur hors limites pour ce modèle`, advice: "Ce modèle accepte une plage plus petite. Envoie un rapport pour que l'appli s'adapte.", raw };
      case 'B00':
        return { sev: 'minor', title: `« ${what} » : l'ampli était occupé`, advice: 'Réessaie dans un instant.', raw };
      default:
        return { sev: 'minor', title: `« ${what} » refusé par l'ampli (code ${code})`, advice: report, raw };
    }
  }

  // Confidentialité : la MAC garde son préfixe constructeur, l'IP perd son dernier octet.
  function maskMac(mac) {
    const hex = String(mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (hex.length < 6) return mac ? 'masquée' : null;
    return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:xx:xx:xx`;
  }
  function maskHost(host) {
    if (!host) return null;
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.replace(/\.\d+$/, '.x') : 'nom d\'hôte masqué';
  }
  const hhmmss = (t) => new Date(t).toISOString().slice(11, 23);

  function buildReport({ app = {}, platform = 'web', state = null, host = null, config = {}, caps = {}, unsupported = {}, journal = [], trace = [], note = '', probe = false, now = Date.now } = {}) {
    const s = state || {};
    return {
      app: 'pioneer-remote', kind: 'diagnostic', version: app.version || '?', platform, date: new Date(now()).toISOString(),
      note: String(note || '').slice(0, 2000), probe: !!probe,
      receiver: {
        model: s.model || null, firmware: s.firmware || null, name: s.friendlyName || null, protocol: s.protocol || 'pioneer',
        levelsMode: s.levelsMode || null, mac: maskMac(s.mac), host: maskHost(host), power: s.power ?? null,
      },
      config, caps, unsupported,
      params: s.params || {}, inputs: Object.keys(s.names || {}),
      journal: journal.slice(0, MAX).map((e) => ({ t: new Date(e.t).toISOString(), sev: e.sev, title: e.title, raw: e.raw, n: e.n || 1 })),
      trace: trace.slice(-TRACE_MAX).map((l) => `${hhmmss(l.t)} ${l.dir === 'tx' ? '→' : l.dir === 'rx' ? '←' : '·'} ${l.text}`),
    };
  }
  const reportSubject = (r) => `[Pioneer Remote] Rapport ${r.receiver?.model || 'modèle inconnu'} fw ${r.receiver?.firmware || '?'} (v${r.version})`;
  const reportFileName = (r) => `pioneer-report-${(r.receiver?.model || 'inconnu').replace(/[^\w-]+/g, '_')}-${r.date.slice(0, 10)}.json`;
  const reportBody = (r) => [
    'Bonjour,', '', 'Voici un rapport de diagnostic de Pioneer Remote (fichier joint).', '',
    `Ampli : ${r.receiver?.model || 'inconnu'} · firmware ${r.receiver?.firmware || '?'}`,
    `Appli : v${r.version} (${r.platform})`, '',
    r.note ? `Problème constaté : ${r.note}` : 'Problème constaté : (décris-le ici)',
  ].join('\n');

  return { createJournal, createTrace, rejectedEntry, maskMac, maskHost, buildReport, reportSubject, reportFileName, reportBody, MAX, TRACE_MAX };
})();
if (typeof module !== 'undefined') module.exports = Diag;
