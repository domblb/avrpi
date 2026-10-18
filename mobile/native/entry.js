'use strict';
// Point d'entrée de l'APK : le moteur de l'appli tourne dans la WebView. On remplace fetch('/api/…') et EventSource('/events')
// par des appels directs, ce qui laisse l'interface identique à la version navigateur.
const { Capacitor, registerPlugin } = require('@capacitor/core');
const { Avr } = require('../../lib/avr');
const { createEngine } = require('../../lib/engine');
const { createProbes, deviceFromXml, rankPrefixes, CONTROL_PORTS } = require('../../lib/discovery-core');
const { createSocketFactory, startDemo } = require('./socket');
const { APP_INFO } = require('../../public/version');

const plugin = Capacitor.isNativePlatform() ? registerPlugin('PioneerNet') : null;
const createSocket = createSocketFactory(plugin);
const probes = createProbes(createSocket);

/* --- stockage : réglages et préréglages dans la WebView --- */
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
const store = {
  getConfig: () => read('pioneer.config', {}), saveConfig: (c) => write('pioneer.config', c),
  loadPresets: () => { const l = read('pioneer.presets', []); return Array.isArray(l) ? l : []; }, savePresets: (l) => write('pioneer.presets', l),
};

/* --- découverte : SSDP natif (multicast) puis balayage TCP du sous-réseau --- */
async function discoverFn({ onProgress = () => {} } = {}) {
  if (!plugin) return [];
  onProgress({ phase: 'ssdp', message: 'Recherche UPnP/SSDP (3 s)…' });
  try {
    const { responses = [] } = await plugin.ssdp({ timeout: 3000 });
    const devs = responses.map((r) => deviceFromXml(r.host, r.xml)).filter(Boolean);
    if (devs.length) { devs.forEach((d) => onProgress({ phase: 'found', device: d, message: `Trouvé par SSDP : ${d.host}` })); return devs; }
  } catch { /* SSDP indisponible : on balaie */ }
  onProgress({ phase: 'ssdp', message: 'SSDP : aucune réponse. Balayage du réseau…' });
  let prefixes = [];
  try { prefixes = rankPrefixes((await plugin.localAddresses()).addresses.map((a) => a.split('.').slice(0, 3).join('.'))); } catch { /* rien */ }
  if (!prefixes.length) { onProgress({ phase: 'scan', message: 'Aucun réseau Wi-Fi local détecté. Vérifie le Wi-Fi.' }); return []; }
  return probes.scan({ prefixes, concurrency: 48, timeout: 800, onProgress });
}

const avr = new Avr({ createSocket });
const engine = createEngine({ avr, store, discoverFn, identifyFn: (h) => probes.identify(h, CONTROL_PORTS), startDemo });

/* --- remplacement du transport HTTP/SSE --- */
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, location.href);
  if (!u.pathname.startsWith('/api/')) return realFetch(url, opts);
  let body = {};
  try { body = opts.body ? JSON.parse(opts.body) : {}; } catch { /* corps vide */ }
  const r = await engine.handle((opts.method || 'GET').toUpperCase(), u.pathname, body);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

class LocalEventSource {
  constructor() {
    this.handlers = {};
    this.unsub = engine.subscribe((ev, data) => this._fire(ev, data));
    setTimeout(() => this._fire('init', engine.snapshot()), 0);
  }
  addEventListener(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  close() { this.unsub(); }
  _fire(ev, data) { for (const fn of this.handlers[ev] || []) fn({ data: JSON.stringify(data) }); }
}
window.EventSource = LocalEventSource;
window.PIONEER_NATIVE = {
  native: !!plugin, version: APP_INFO.version,
  // Boutons de volume du téléphone → volume de l'ampli (activé seulement quand l'option est cochée et l'ampli connecté)
  setVolumeKeys: (on) => { if (plugin) plugin.setVolumeKeys({ enabled: !!on }).catch(() => {}); },
  // Rapport de diagnostic (fichier joint au mail ou partagé) et liens externes
  shareReport: (r) => plugin.shareReport(r),
  openUrl: (url) => { plugin?.openUrl({ url }).catch(() => {}); },
};

/* --- arrière-plan : l'ampli n'accepte qu'un client à la fois. Après une minute en arrière-plan on libère la connexion
   (télécommande d'origine, PC…) ; au retour on se reconnecte, ce qui relit aussi tout l'état. --- */
let bgTimer = null, released = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(bgTimer);
    bgTimer = setTimeout(() => {
      if (engine.isDemo() || !avr.host || avr.status === 'disconnected') return;
      released = { host: avr.host, port: avr.port, proto: avr.proto };
      avr.disconnect();
    }, 60000);
  } else {
    clearTimeout(bgTimer); bgTimer = null;
    if (released) { const r = released; released = null; avr.connect(r.host, r.port, r.proto); }
  }
});

/* --- reconnexion automatique à l'ampli mémorisé --- */
window.addEventListener('DOMContentLoaded', () => {
  const c = store.getConfig();
  if (c.host && c.port) avr.connect(c.host, c.port, c.proto);
  // Android 16+ : accès au réseau local (permission d'exécution ; ignorée sur les versions antérieures)
  if (plugin) plugin.requestPermissions().catch(() => {});
});
