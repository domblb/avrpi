# Pioneer Remote

A full remote control for Pioneer VSX / SC network receivers (tested on the VSX-921 and VSX-1021), replacing iControlAV2 and iControlAV5.
Android app, plus a web version with no dependencies: Node.js 18 or later is all it needs.

> **Unofficial** app, not affiliated with Pioneer or Onkyo. Website: https://pioneer-remote.vercel.app

## Install on Android

1. On your phone, open **[the latest release](https://github.com/domblb/pioneer-remote/releases/latest)** and download `Pioneer-Remote-X.Y.Z.apk`.
2. Tap the downloaded file. If Android blocks it: **Settings** → allow this source → go back.
3. Tap **Install** (if Play Protect warns you: "Install anyway").

Updates install over the top and keep your settings. **Settings → About → Check for updates** tells you when a new version is out.

Runs on Android 7 through the latest release. Pioneer's iControlAV2 and iControlAV5 were built for Android 2.2 / 2.3, and Android 14 and later refuse to install them.

## Your receiver doesn't behave as expected?

The app detects what each model can do, but many have never been tested on real hardware, so bugs are possible.
Tap the **⚠** icon at the top (or **Settings → About → Send a report**), tick **Full diagnostic** and send the report by email:
it contains the model, the firmware and the receiver's answers (IP and MAC addresses masked), which is usually enough to fix the app for your model.
You can also [open an issue](https://github.com/domblb/pioneer-remote/issues/new).

## Support the project

The app is free and open source. If it's useful to you, you can support its development on Patreon (link in **Settings → About**).

## Run the web version

```
cd app
npm start            # http://localhost:3000
```

On first launch: **Find the receiver** (SSDP, then a network scan checking `?P` → `PWR`),
or type its IP address. The address is saved in `config.json` and reconnected on startup.

## Compatibility with other receivers

The app doesn't assume a VSX-1021: it **detects what the receiver can do** during the initial read and only shows that.

- **Adaptive screens**: Zones (zone 2 and/or zone 3), Radio, Video and Speakers only appear if the receiver answers.
- **Tolerant formats**: variable number of level channels, equaliser bands and inputs; short or long `?AST` answer.
- **Two families of channel levels**: `ILV` (older VSX, one block) and `CLV` (newer models, channel by channel). The rest of the app doesn't see the difference.
- **eISCP**: 2018+ Pioneer receivers (port 60128) go through a translation layer (`lib/eiscp.js`).
- **Identification**: model (`RGD`), firmware (`SSI`), network name (`SSO`) and MAC address (`SVB`) are read and displayed.
- **Compatibility settings** (Settings → Compatibility): delay between commands (some models need more than 100 ms) and volume scale (max, 0 dB value, dB per step).
- **Caution**: installation settings (cut-off, surround position, X-curve, speaker configuration, locks) ask for confirmation, and the engine refuses them without `confirm`.

Codes for models other than the VSX-921 / VSX-1021 come from the `aiopioneer` library and haven't been tested on hardware: if a setting
has no effect on your receiver, it simply won't show up (or the receiver will answer "NOT AVAILABLE"). The **demo mode** offers five
simulated receivers to see these differences without hardware.

## Demo mode

No receiver at hand? On the connection screen (or in **Settings**), **Try the demo** starts a simulated receiver
inside the app: real inputs (CD, TUNER, BD…), radio stations, display, and a speaker plan that follows the listening
mode (STEREO direct = front only, STANDARD = 5.1…). A banner reminds you that no real device is being controlled;
nothing is saved in `config.json`. **Exit demo** turns it off.

## Comfort

- Progress bar during the initial read, **Receiver in standby** banner with a *Power on* button.
- Volume: hold − / + to repeat; keyboard shortcuts (`↑` `↓` volume, `M` mute, `P` power, `1`–`9` screens, `?` help).
- Light/dark theme in one click, input icons, title and description on every screen.
- Mobile: bottom bar (Home, Speakers, Sound, Presets) + **More** menu; no horizontal scrolling.
- Error log (⚠ icon) instead of error pop-ups; the phone's volume keys can drive the receiver.

## Screens

| Screen | Contents |
|---|---|
| Home | Receiver display, volume dial, mute, inputs, listening mode, presets, **Emphasis card** |
| Speakers | Room plan: state of each channel, levels (±12 dB), **directed balance** by dragging the listening spot, solo a channel (hold), move speakers, speaker system, `SSC` system settings |
| Sound | **Emphasis**, listening modes (117 codes, detection of available modes), advanced audio settings (≈25 parameters), tone, ±6 dB graphic equaliser |
| Video | Converter, resolution, Pure Cinema, advanced settings (`VT*`) |
| Zone 2 / Radio | Zone 2; frequency and A–G memories |
| Presets | One-tap scenes captured from the current state |
| Terminal / Settings | Raw codes; volume limit, theme, about |

### Dialogue and bass emphasis

"Emphasis" card (Home and Sound):
- **Dialogue**: *Dialog Enhancement* (`ATH`: Off, Flat, +1…+4) and centre channel level (`ILV`).
- **Bass**: subwoofer level (`ILV`), tone bass (`BA`, ±6 dB, tone on) and LFE attenuator (`ATM`: 0, −5, −10, −15, −20 dB, off).
- Quick scenes: *Neutral*, *Dialogue* (ATH +2, centre +3 dB), *Bass* (subwoofer +3 dB, tone +3 dB), *Dialogue + bass*.

Some settings (`ATP`, `ATS`, `ATR`, `ATU`, `ATE`…) are only valid in certain listening modes: the receiver shows
"NOT AVAILABLE" and the app reports it.

## Safety

- **Volume limit**: the engine refuses any volume above the ceiling (dial, presets, terminal). Adjustable in Settings, 0 dB by default.
- The dial only moves when you grab the knob (no jump on a click).
- The web server listens locally only; for a phone: `HOST=0.0.0.0 npm start` (no authentication, trusted network only).

## Protocol (confirmed on a VSX-1021)

TCP port **23** (telnet) or **8102**; ASCII commands terminated by `\r`. Read: `?V` → `VOL130`. Write: **value before the code**
(`050VL`, `04FN`, `1IS`, `3ATH`, `<17×2 digits>ILV`, `<11×2 digits>ATB`). `50` = neutral for `ILV`/`ATB`/`VT*`, 1 unit = 0.5 dB.
Tables in `lib/protocol.js`; sources: VSX-1021 answers, the iControlAV2 APK and
[aiopioneer](https://github.com/crowbarz/aiopioneer) (listening modes, DSP parameters, `?AST` layout).

Good to know:
- Port 8102 accepts one connection at a time; port 23 can be used in parallel.
- Zone 3 and several recent parameters (`ATI`, `ATV`, `ATW`, `ATY`, `ATZ`, `VSP`, `VWD`) aren't handled by this model: they don't appear.
- `ATF` (delay) is expressed in frames (0.1 per step) on this model; `ATM` is written with 1 digit.
- Labels of the `VTE…VTQ` video settings come from community documentation, not verified on the receiver.

## Tests

```
npm run fake         # fake receiver (TCP 8102 + SSDP) to try without hardware
npm test             # protocol, parameters, discovery, API, presets, volume ceiling, error log, demo
```

Variables: `PORT`, `HOST`, `PIONEER_CONFIG`, `PIONEER_PRESETS` (paths of the config / presets files).

## Releases

The version lives in `public/version.js`. Pushing a tag `vX.Y.Z` that matches it builds the signed APK on GitHub Actions
and attaches it to the release. The website lives in `site/` (static, deployed on Vercel).
