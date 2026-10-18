'use strict';
// Journal des erreurs (icône ⚠ de l'en-tête), rapport de diagnostic envoyé à l'auteur, carte « À propos ».
const NATIVE = () => window.PIONEER_NATIVE?.native ? window.PIONEER_NATIVE : null;

/* --- trace des trames échangées, pour le rapport --- */
App.trace = Diag.createTrace();
App.on('log', (l) => App.trace.push(l.dir, l.text));
App.on('sync', (p) => { App.lastSync = { ...p, at: Date.now() }; });

/* --- icône + badge --- */
const diagBtn = $('#topDiag');
diagBtn.innerHTML = `${icon('alert')}<span class="count"></span>`;
let shownUnread = 0;
function syncDiagBtn() {
  const n = App.journal.unread, total = App.journal.list().length;
  diagBtn.hidden = !total;
  $('.count', diagBtn).textContent = n ? (n > 99 ? '99+' : String(n)) : '';
  if (n > shownUnread) { diagBtn.classList.remove('pulse'); void diagBtn.offsetWidth; diagBtn.classList.add('pulse'); }
  shownUnread = n;
}
App.journal.on(syncDiagBtn);
syncDiagBtn();
diagBtn.onclick = () => journalDialog();

const timeFmt = (t) => { const d = new Date(t); return d.toLocaleDateString() === new Date().toLocaleDateString() ? d.toLocaleTimeString() : d.toLocaleString(); };

function journalDialog() {
  const d = $('#dlg'); d.innerHTML = '';
  const items = App.journal.list();
  const list = h('ul', { class: 'journal' }, items.map((e) => h('li', { class: e.sev },
    h('span', { class: 'when', text: `${timeFmt(e.t)}${e.n > 1 ? ` · ×${e.n}` : ''}` }),
    h('b', { text: e.title }),
    e.advice ? h('p', { text: e.advice }) : null,
    e.raw ? h('code', { text: e.raw }) : null)));
  d.append(h('h3', { text: 'Journal des erreurs' }),
    items.length ? list : h('p', { class: 'muted', text: 'Aucune erreur pour l\'instant.' }),
    h('p', { class: 'muted', style: 'font-size:12px', text: "Un réglage que l'ampli ne connaît pas est souvent normal. Si quelque chose ne marche pas comme prévu, envoie un rapport : il aide à adapter l'appli à ton modèle." }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', text: 'Effacer', onclick: () => { App.journal.clear(); d.close(); } }),
      h('button', { class: 'btn', type: 'button', text: 'Fermer', onclick: () => d.close() }),
      h('button', { class: 'btn primary', type: 'button', text: 'Envoyer un rapport', onclick: () => reportDialog() })));
  d.onclose = null; d.showModal();
  App.journal.markRead();
}

/* --- rapport de diagnostic --- */
function collectReport(note, probe) {
  return Diag.buildReport({
    app: APP_INFO, platform: NATIVE() ? 'android' : 'web', state: App.demo ? { ...App.state, model: `${App.state?.model || '?'} (démo)` } : App.state, host: App.demo ? null : App.host,
    config: { commandDelay: App.meta.commandDelay, volumeScale: App.meta.volumeScale, maxVolume: App.meta.maxVolume, lang: I18N.lang, userAgent: navigator.userAgent },
    caps: App.caps(), unsupported: store.get(`unsup:${App.state?.model || ''}`, {}),
    journal: App.journal.list(), trace: App.trace.lines(), note, probe,
  });
}

// Diagnostic complet : relecture de tout l'état ; terminé quand la file d'interrogation est vide depuis un moment.
async function runProbe(onProgress) {
  const start = Date.now();
  App.lastSync = null;
  await App.api('/api/refresh');
  await new Promise((resolve) => {
    const tick = () => {
      const s = App.lastSync;
      if (s?.total) onProgress(s.total - s.remaining, s.total);
      if ((s && s.remaining === 0 && Date.now() - s.at > 2000) || Date.now() - start > 120000) return resolve();
      setTimeout(tick, 400);
    };
    setTimeout(tick, 800);
  });
}

function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

async function sendReport(report, direct) {
  const text = JSON.stringify(report, null, 1), fileName = Diag.reportFileName(report);
  const subject = Diag.reportSubject(report), body = Diag.reportBody(report);
  const nat = NATIVE();
  if (nat?.shareReport) {
    await nat.shareReport({ text, fileName, subject, body, email: direct ? APP_INFO.reportEmail : '' });
    return;
  }
  // Navigateur : impossible de joindre un fichier à un mail. On le télécharge, puis on ouvre le mail pré-rempli.
  download(fileName, text);
  if (direct) {
    const mail = `mailto:${APP_INFO.reportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}\n\n(Joins le fichier ${fileName} qui vient d'être téléchargé.)`)}`;
    const a = h('a', { href: mail }); document.body.append(a); a.click(); a.remove();
  }
}

function reportDialog() {
  const d = $('#dlg'); d.innerHTML = '';
  const note = h('textarea', { class: 'note', placeholder: "Qu'est-ce qui ne marche pas ? (ex. « le réglage Dialogue ne fait rien »)", 'aria-label': 'Description du problème' });
  const connected = App.status === 'connected';
  const probe = h('input', { type: 'checkbox', checked: connected, disabled: !connected });
  const status = h('p', { class: 'muted msg' });
  const preview = h('pre', { class: 'report-pre', hidden: true });
  const busy = (on) => $$('button', d).forEach((b) => { b.disabled = on; });
  const go = async (direct) => {
    busy(true);
    try {
      if (probe.checked && App.status === 'connected') {
        status.textContent = 'Lecture de tous les réglages de l\'ampli…';
        await runProbe((done, total) => { status.textContent = `Lecture de tous les réglages de l'ampli : ${done} / ${total}`; });
      }
      status.textContent = 'Préparation du rapport…';
      await sendReport(collectReport(note.value.trim(), probe.checked), direct);
      status.textContent = NATIVE() ? 'Rapport prêt : choisis comment l\'envoyer.' : 'Fichier téléchargé.';
      store.set('lastReport', Date.now());
    } catch (e) {
      status.textContent = `Envoi impossible : ${e.message || e}`; status.classList.add('err');
    }
    busy(false);
  };
  d.append(h('h3', { text: 'Envoyer un rapport à l\'auteur' }),
    h('p', { class: 'muted', style: 'font-size:13px', text: "Le rapport contient le modèle et le firmware de l'ampli, ce qu'il sait faire, les dernières commandes échangées et le journal des erreurs. Aucune donnée personnelle : l'adresse IP et l'adresse MAC sont masquées." }),
    note,
    h('label', { class: 'check' }, probe, h('span', {}, 'Diagnostic complet', h('small', { class: 'muted', style: 'display:block', text: "Relit tous les réglages de l'ampli (environ 30 s, rien n'est modifié). Recommandé pour un modèle mal reconnu." }))),
    status,
    h('details', { ontoggle: (e) => { if (e.target.open) { preview.textContent = JSON.stringify(collectReport(note.value.trim(), false), null, 1); preview.hidden = false; } } },
      h('summary', { class: 'muted', style: 'cursor:pointer;font-size:13px', text: 'Voir le contenu du rapport' }), preview),
    h('div', { class: 'actions', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn', type: 'button', text: 'Fermer', onclick: () => d.close() }),
      h('button', { class: 'btn', type: 'button', text: NATIVE() ? 'Partager autrement' : 'Télécharger le fichier', onclick: () => go(false) }),
      h('button', { class: 'btn primary', type: 'button', html: `${icon('mail')}<span>Envoyer par mail</span>`, onclick: () => go(true) })));
  d.onclose = null;
  if (!d.open) d.showModal();
}

/* --- liens externes et mise à jour --- */
function openExternal(url) {
  const nat = NATIVE();
  if (nat?.openUrl) nat.openUrl(url); else window.open(url, '_blank', 'noopener');
}
const cmpVersion = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};
async function checkUpdate(out) {
  out.textContent = 'Recherche…';
  try {
    const r = await fetch(`https://api.github.com/repos/${APP_INFO.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 ? 'aucune version publiée' : `HTTP ${r.status}`);
    const rel = await r.json();
    out.innerHTML = '';
    if (cmpVersion(rel.tag_name, APP_INFO.version) <= 0) { out.textContent = `Tu as la dernière version (${APP_INFO.version}).`; return; }
    const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
    out.append(h('span', { text: `Nouvelle version disponible : ${rel.tag_name.replace(/^v/, '')}` }), ' ',
      h('button', { class: 'btn small primary', type: 'button', text: NATIVE() && apk ? 'Télécharger l\'APK' : 'Voir la version', onclick: () => openExternal(NATIVE() && apk ? apk.browser_download_url : rel.html_url) }));
  } catch (e) { out.textContent = `Recherche impossible : ${e.message}`; }
}

// Carte « À propos » des Réglages
function AboutCard() {
  const upd = h('p', { class: 'muted msg', style: 'font-size:13px' });
  const repoUrl = `https://github.com/${APP_INFO.repo}`;
  // Lien de soutien (Ko-fi…) : lu sur le site pour pouvoir en changer sans nouvelle version ; dernier lien connu gardé hors ligne
  const supportBtn = h('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => { const s = store.get('supportLink', null); if (s?.url) openExternal(s.url); } });
  const showSupport = (s) => {
    const ok = !!s?.url && /^https:\/\//.test(s.url);
    supportBtn.hidden = !ok;
    if (ok) supportBtn.innerHTML = `${icon('heart')}<span>${s.name ? `Soutenir sur ${s.name}` : 'Soutenir le projet'}</span>`;
  };
  showSupport(store.get('supportLink', null));
  fetch(APP_INFO.links, { cache: 'no-cache' }).then((r) => r.json()).then(({ support }) => {
    store.set('supportLink', support?.url ? { url: support.url, name: support.name || '' } : null);
    showSupport(store.get('supportLink', null));
  }).catch(() => { /* hors ligne : on garde le dernier lien connu */ });
  return h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'À propos' }), h('span', { class: 'badge', text: `v${APP_INFO.version}` })),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Pioneer Remote est une application gratuite et open source, développée sur mon temps libre. Application non officielle, non affiliée à Pioneer ni à Onkyo.' }),
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn', type: 'button', text: 'Rechercher une mise à jour', onclick: () => checkUpdate(upd) }),
      h('button', { class: 'btn', type: 'button', text: 'Code source et versions', onclick: () => openExternal(`${repoUrl}/releases`) }),
      supportBtn),
    upd,
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn', type: 'button', text: 'Journal des erreurs', onclick: () => journalDialog() }),
      h('button', { class: 'btn', type: 'button', html: `${icon('mail')}<span>Envoyer un rapport</span>`, onclick: () => reportDialog() })));
}
window.journalDialog = journalDialog;
window.reportDialog = reportDialog;
