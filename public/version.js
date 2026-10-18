'use strict';
// Version et liens de l'appli : source unique (lue aussi par mobile/android/app/build.gradle).
const APP_INFO = {
  version: '1.2.1',
  repo: 'domblb/pioneer-remote',
  reportEmail: 'monforfaitfute@gmail.com',
  links: 'https://pioneer-remote.vercel.app/links.json',   // lien de soutien (Ko-fi…), modifiable sans nouvelle version
};
if (typeof module !== 'undefined') module.exports = { APP_INFO };
