'use strict';
// Traduction de l'interface. Le texte source est le français ; chaque langue est un dictionnaire { français: traduction }
// chargé à la demande (lang-xx.js). Les textes du DOM (contenu, placeholder, title, aria-label) sont traduits par un
// observateur, donc tout texte qui arrive à l'écran, y compris les messages du serveur, l'est aussi. Les clés qui
// contiennent {} sont des modèles (nombre, nom…) : les valeurs captées sont reportées dans la traduction.
const I18N = (() => {
  const LANGS = {
    fr: 'Français', en: 'English', de: 'Deutsch', es: 'Español', it: 'Italiano', nl: 'Nederlands', pt: 'Português',
    ru: 'Русский', pl: 'Polski', tr: 'Türkçe', zh: '中文', ja: '日本語', ko: '한국어',
  };
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const dicts = {};            // langue -> dictionnaire
  let lang = 'fr', exact = new Map(), patterns = [], depth = 0;
  const origText = new WeakMap(), outText = new WeakMap(), origAttr = new WeakMap();

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function prepare(dict) {
    exact = new Map(); patterns = [];
    if (!dict) return;
    for (const [k, v] of Object.entries(dict)) {
      if (!v) continue;
      if (k.includes('{}')) {
        if (!/[A-Za-zÀ-ÿЀ-ӿ]/.test(k.replace(/\{\}/g, ''))) continue;   // « {} » seul capterait tout
        const parts = k.split('{}');
        patterns.push({ re: new RegExp('^' + parts.map(esc).join('(.+?)') + '$', 's'), to: v, len: k.length });
      } else exact.set(k, v);
    }
    patterns.sort((a, b) => b.len - a.len);
  }
  // Traduit une chaîne (les espaces de début/fin sont conservés)
  function t(s) {
    if (lang === 'fr' || typeof s !== 'string' || !s) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2];
    if (!core) return s;
    let r = exact.get(core);
    if (r === undefined) {
      for (const p of patterns) {
        const x = p.re.exec(core);
        if (x) { let i = 1; r = p.to.replace(/\{\}/g, () => { const v = x[i++] ?? ''; if (depth > 3 || v === core) return v; depth++; try { return t(v); } finally { depth--; } }); break; }
      }
    }
    if (r === undefined) {                                   // « Titre (12) » : traduit le titre, garde le compteur
      const c = /^(.*?)(\s*\(\d+\))$/.exec(core);
      if (c && c[1]) { const t0 = t(c[1]); if (t0 !== c[1]) r = t0 + c[2]; }
    }
    return r === undefined ? s : m[1] + r + m[3];
  }

  function doText(node) {
    const cur = node.data;
    const known = outText.get(node);
    if (known !== undefined && cur === known) return;          // notre propre écriture
    if (lang === 'fr') { origText.set(node, cur); outText.delete(node); return; }
    origText.set(node, cur);
    const r = t(cur);
    if (r !== cur) { outText.set(node, r); node.data = r; } else outText.delete(node);
  }
  function doAttrs(el) {
    let o = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      if (o && o[a] && o[a].out === cur) continue;
      if (!o) { o = {}; origAttr.set(el, o); }
      const r = lang === 'fr' ? cur : t(cur);
      o[a] = { orig: cur, out: r };
      if (r !== cur) el.setAttribute(a, r);
    }
  }
  function scan(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (/^(SCRIPT|STYLE)$/.test(root.tagName)) return; doAttrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (!/^(SCRIPT|STYLE)$/.test(n.parentNode?.tagName || '')) doText(n); } else doAttrs(n);
    }
  }
  // Retraduit tout depuis les textes d'origine (changement de langue)
  function rescan() {
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        const o = origText.get(n);
        if (o === undefined) { doText(n); continue; }
        const r = lang === 'fr' ? o : t(o);
        if (n.data !== r) n.data = r;
        if (r !== o) outText.set(n, r); else outText.delete(n);
      } else {
        const o = origAttr.get(n);
        if (o) for (const a of Object.keys(o)) { const r = lang === 'fr' ? o[a].orig : t(o[a].orig); o[a].out = r; if (n.getAttribute(a) !== r) n.setAttribute(a, r); }
        else doAttrs(n);
      }
    }
    document.title = lang === 'fr' ? 'AVRpi' : t('AVRpi');
  }

  let obs = null, busy = false;
  function observe() {
    if (obs || typeof MutationObserver === 'undefined') return;
    obs = new MutationObserver((muts) => {
      if (busy) return; busy = true;
      try {
        for (const m of muts) {
          if (m.type === 'childList') m.addedNodes.forEach((n) => scan(n));
          else if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'attributes') doAttrs(m.target);
        }
      } finally { busy = false; }
      obs.takeRecords();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  const loadDict = (code) => new Promise((resolve) => {
    if (code === 'fr' || dicts[code]) return resolve();
    const s = document.createElement('script');
    s.src = `lang-${code}.js`; s.onload = () => resolve(); s.onerror = () => resolve();
    document.head.append(s);
  });

  function detect() {
    let saved = null;
    try { saved = localStorage.getItem('pr:lang'); if (saved) saved = JSON.parse(saved); } catch { /* stockage indisponible */ }
    if (saved && LANGS[saved]) return saved;
    for (const l of navigator.languages || [navigator.language || 'fr']) {
      const c = String(l).toLowerCase().split('-')[0];
      if (LANGS[c]) return c;
    }
    return 'en';
  }

  async function set(code, persist = true) {
    if (!LANGS[code]) code = 'fr';
    await loadDict(code);
    lang = code; prepare(dicts[code]);
    document.documentElement.lang = code;
    if (persist) { try { localStorage.setItem('pr:lang', JSON.stringify(code)); } catch { /* ignoré */ } }
    busy = true; try { rescan(); } finally { busy = false; }
    window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
  }

  return {
    LANGS, t, set, get lang() { return lang; },
    register(code, dict) { dicts[code] = dict; },
    async init() { observe(); await set(detect(), false); },
  };
})();
window.t = I18N.t;
