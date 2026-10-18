# Pioneer Remote — application Android (APK)

Application autonome : aucun PC ni serveur. L'interface est celle de la version navigateur (`../public`) ; le moteur
(`../lib/engine.js`, protocole, préréglages, découverte) tourne dans la WebView. Un petit plugin Java
(`android/app/src/main/java/fr/pioneerremote/app/PioneerNetPlugin.java`) fournit les sockets TCP, le SSDP multicast et les adresses locales.

- Android 7.0 (API 24) et plus, ciblé Android 16 (API 36).
- Les préréglages et réglages sont stockés dans l'appli (WebView).
- Le mode démo fonctionne sans réseau (récepteur simulé en mémoire).

## Construire l'APK

Prérequis : Node 18+, JDK 17 ou 21, Android SDK (plateforme 36, build-tools). `ANDROID_HOME` ou `android/local.properties` (`sdk.dir=…`).

```bash
cd mobile
npm install
npm run debug      # APK de test   → android/app/build/outputs/apk/debug/app-debug.apk
npm run release    # APK de diffusion signé → android/app/build/outputs/apk/release/app-release.apk
```

Sans SDK local : le workflow GitHub `../.github/workflows/android.yml` construit l'APK dans le cloud
(onglet Actions → « APK Android » → Run workflow, ou en poussant un tag `v1.0.0`, qui publie l'APK dans la release).

## Signature (diffusion)

`keystore/pioneer-release.jks` + `keystore/keystore.properties` sont générés localement, hors Git.
**Sauvegarde ce dossier** : toute mise à jour installée par-dessus doit être signée avec la même clé.
Pour la CI : secrets `PIONEER_KEYSTORE_B64` (`base64 -w0 keystore/pioneer-release.jks`), `PIONEER_STORE_PASSWORD`, `PIONEER_KEY_PASSWORD`.

## Distribuer

Envoie le fichier `.apk` (messagerie, lien de téléchargement, release GitHub). Sur le téléphone : ouvrir le fichier, autoriser
« installer des applications inconnues » pour l'appli utilisée, installer. Play Protect peut afficher un avertissement
pour une application hors Play Store : « Installer quand même ».

## Tester sans téléphone

`node build-web.js && node serve-www.js` puis http://127.0.0.1:3002 : le moteur local tourne dans le navigateur, en démo seulement.
Test automatique du moteur sans réseau : `node --test test/native.test.js` (dossier parent).
