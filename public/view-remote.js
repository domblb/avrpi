'use strict';
// Télécommande virtuelle : navigation dans les menus de l'ampli (affichés sur la TV) et touches de paramètres.
(function remote() {
  const el = h('section', { class: 'view', 'data-view': 'remote' });
  const lcd = h('div', { class: 'lcd' }, h('div', { class: 'l1', text: '—' }));
  const key = (name, label, cls = '', title = '') => holdRepeat(h('button', { class: `btn key ${cls}`, type: 'button', 'aria-label': title || label, title: title || label, text: label }), name);
  const once = (name, label, title) => h('button', { class: 'btn', type: 'button', title: title || label, text: label, onclick: () => App.cmd(name) });
  const pad = h('div', { class: 'dpad' },
    h('span'), key('keyUp', '▲', '', 'Haut'), h('span'),
    key('keyLeft', '◀', '', 'Gauche'), h('button', { class: 'btn key primary', type: 'button', text: 'OK', title: 'Valider', onclick: () => App.cmd('keyEnter') }), key('keyRight', '▶', '', 'Droite'),
    h('span'), key('keyDown', '▼', '', 'Bas'), h('span'));
  el.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Navigation' }), h('span', { class: 'badge', text: 'menus affichés à l\'écran' })), lcd, pad,
      h('div', { class: 'row', style: 'justify-content:center' }, once('keyReturn', '↩ Retour'), once('keyHome', '⌂ Menu principal'), once('keyStatus', 'ⓘ Statut'))),
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Menus de paramètres' })),
      h('div', { class: 'chips' }, once('keyAudioParam', 'Paramètres audio'), once('keyVideoParam', 'Paramètres vidéo'), once('keyOutputParam', 'Sortie HDMI'), once('keyChannel', 'Sélection du canal')),
      h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: "Ces touches envoient les mêmes codes que la télécommande de l'ampli : elles ouvrent ses menus sur l'afficheur et la TV. Selon le modèle, certaines n'ont pas d'effet." }),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', type: 'button', text: 'Quitter les menus', onclick: () => App.cmd('keyOff') })))));
  function update(s) { lcd.firstChild.textContent = s.display || '—'; }
  App.register('remote', { el, update, title: 'Télécommande', icon: 'dpad' });
})();
