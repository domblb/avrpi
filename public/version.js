'use strict';
// Version et liens de l'appli : source unique (lue aussi par mobile/android/app/build.gradle).
const APP_INFO = {
  version: '1.3.0',
  repo: 'domblb/avrpi',
  reportEmail: 'monforfaitfute@gmail.com',
  links: 'https://avrpi.vercel.app/links.json',   // lien de soutien (Ko-fi…), modifiable sans nouvelle version
};
if (typeof module !== 'undefined') module.exports = { APP_INFO };
