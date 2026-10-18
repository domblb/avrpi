'use strict';
// Version et liens de l'appli : source unique (lue aussi par mobile/android/app/build.gradle).
const APP_INFO = {
  version: '1.2.0',
  repo: 'domblb/pioneer-remote',
  reportEmail: 'monforfaitfute@gmail.com',
  patreon: '',   // URL de la page Patreon ; vide = bouton masqué
};
if (typeof module !== 'undefined') module.exports = { APP_INFO };
