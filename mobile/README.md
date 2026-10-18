# AVRpi — Android app (APK)

Standalone app: no PC or server needed. The interface is the same as the browser version (`../public`); the engine
(`../lib/engine.js`, protocol, presets, discovery) runs inside the WebView. A small Java plugin
(`android/app/src/main/java/fr/pioneerremote/app/PioneerNetPlugin.java`) provides TCP sockets, SSDP multicast, local addresses,
sharing of diagnostic reports and opening external links.

- Android 7.0 (API 24) and later, targeting Android 16 (API 36).
- Presets and settings are stored in the app (WebView).
- Demo mode works without a network (simulated receiver in memory).
- The version comes from `../public/version.js` (versionCode = X×10000 + Y×100 + Z).

## Build the APK

Requirements: Node 18+, JDK 17 or 21, Android SDK (platform 36, build-tools). `ANDROID_HOME` or `android/local.properties` (`sdk.dir=…`).

```bash
cd mobile
npm install
npm run debug      # test APK          → android/app/build/outputs/apk/debug/app-debug.apk
npm run release    # signed release APK → android/app/build/outputs/apk/release/app-release.apk
```

Without a local SDK: the GitHub workflow `../.github/workflows/android.yml` builds the APK in the cloud
(Actions tab → "APK Android" → Run workflow, or push a tag `vX.Y.Z`, which publishes the APK in the release).

## Signing (distribution)

`keystore/pioneer-release.jks` + `keystore/keystore.properties` are generated locally and kept out of Git.
**Back up this folder**: every update installed over the app must be signed with the same key.
For CI: secrets `PIONEER_KEYSTORE_B64` (base64 of `keystore/pioneer-release.jks`), `PIONEER_STORE_PASSWORD`, `PIONEER_KEY_PASSWORD`.

## Distribute

Share the latest release link: https://github.com/domblb/avrpi/releases/latest. On the phone: open the file, allow
"install unknown apps" for the app used to open it, then install. Play Protect may show a warning for an app from outside
the Play Store: "Install anyway".

## Test without a phone

`node build-web.js && node serve-www.js`, then http://127.0.0.1:3002: the local engine runs in the browser, demo only.
Automated engine test without a network: `node --test test/native.test.js` (from the parent folder).
